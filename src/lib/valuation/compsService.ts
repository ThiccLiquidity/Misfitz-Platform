// Builds and caches the per-collection comparable-sales model. THIS is where the heavy lifting lives —
// it is intentionally kept OFF the user's request path: callers either await a warm cache or kick a
// background build and use the old estimate until the model is ready (see liveCollection).
//
// Cost model: one Dexie sales scan + up to `maxNfts` cached MintGarden detail fetches (rank + traits)
// for the most-recently-sold NFTs. Detail fetches are individually TTL-cached in the client, and the
// finished model is cached here for 45 min, so steady-state cost is ~zero. valueOf() is pure arithmetic.
//
// Persistence: the model's *inputs* (the cleaned per-sale rank/price/date/traits + supply/floor/trait
// frequencies) are written through to the DB. buildCompsModel() is pure, cheap arithmetic — so on a cold
// process (or after the 45-min memory TTL) we rehydrate the FULL model from those persisted inputs with
// ZERO network calls, and the trending-traits/curve appear instantly instead of waiting on a rebuild.

import { fetchCollectionCompletedSales, fetchCollectionFloor, fetchCollectionSalesTip } from "@/lib/market/dexie";
import { rarityFactorForPercentile } from "@/lib/valuation/estimate";
import { getNftDetailsBatch } from "@/lib/data-sources/mintgarden/client";
import { buildCompsModel, type CompsModel, type Sale, type Trait } from "@/lib/valuation/comps";
import { cacheGet, cachePut, keepAlive, tryLock, releaseLock } from "@/lib/db/nftCache";
import { getCollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";
import { isSeeded, getSeed, numberFromName } from "@/lib/data-sources/seed/registry";
import { adaptiveHalfLifeOptions } from "@/lib/valuation/compsConfig";
import { activityLevel, recordSalesActivity } from "@/lib/market/activity";

interface CacheEntry { model: CompsModel | null; expiresAt: number; building?: Promise<CompsModel | null> }
const _cache = new Map<string, CacheEntry>();
const _newestSaleAt = new Map<string, number>(); // newest sale (ms) currently baked into each collection's model
const _lastProbe = new Map<string, number>();     // last tip-probe time per collection (event-driven refresh throttle)
const PROBE_THROTTLE_MS = 60_000;                  // at most one Dexie tip-probe per collection per minute per instance
const _builtAt = new Map<string, number>();        // when each collection's model was last (re)built — powers the "values as of" freshness UI
const TTL = 45 * 60_000;
const DB_TTL = 6 * 60 * 60_000; // keep persisted inputs 6h; we still background-refresh once memory expires
const REFRESH_AGE_MS = 2 * 60 * 60_000; // background-refresh a rehydrated model once its inputs pass this age.
// MUST be < DB_TTL (minus build time): at DB_TTL the blob is already a cacheGet miss, so the refresh would
// never fire and every collection would hit a cold "warming" window every 6h. 2h keeps hot models fresh cheaply.

// Refresh a rehydrated model SOONER when the collection is busy: a hot collection folds in a new sale within
// ~20 min instead of 2h; a quiet one keeps the cheap long interval. The level is seeded from the persisted
// sale timestamps on rehydrate, so this works on a cold serverless instance with zero network calls.
function adaptiveRefreshAge(colId: string): number {
  const lvl = activityLevel(colId);
  return lvl === 2 ? 20 * 60_000 : lvl === 1 ? 60 * 60_000 : REFRESH_AGE_MS;
}
const MAX_NFTS = 300; // cap on detail fetches for a cold build (bounds cost; recency-prioritised)
const CONC = 6;

type TraitFreq = Record<string, Record<string, number>>;
interface PersistedSale { rank: number; price: number; soldAt: number; traits?: Trait[]; seller?: string; buyer?: string }
interface PersistedComps { supply: number; floor: number; traitFreq?: TraitFreq; sales: PersistedSale[]; builtAt: number }

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

// Rehydrate a full model from persisted inputs — pure arithmetic, no network. ageDays is recomputed
// from the absolute sale timestamps so recency weighting stays correct however long the blob has sat.
function modelFromPersisted(p: PersistedComps): CompsModel | null {
  const now = Date.now();
  const sales: Sale[] = p.sales.map((s) => ({
    rank: s.rank,
    price: s.price,
    ageDays: (now - s.soldAt) / 86_400_000,
    traits: s.traits,
    seller: s.seller,
    buyer: s.buyer,
  }));
  return buildCompsModel(sales, p.supply, {
    floor: p.floor,
    rarityFactor: rarityFactorForPercentile,
    traitFreq: p.traitFreq,
    ...adaptiveHalfLifeOptions(),
  });
}

// One fetched sale before we\'ve resolved a usable rank. mgRank is MintGarden\'s rank if present, else
// null (a collection MintGarden hasn\'t ranked — we fall back to OUR computed ranks below).
interface SaleRow { id: string; mgRank: number | null; num: number | null; price: number; ageDays: number; soldAt: number; traits: Trait[]; seller?: string; buyer?: string }

async function build(colId: string, opts: { fresh?: boolean } = {}): Promise<CompsModel | null> {
  const [sales, floorXch] = await Promise.all([
    fetchCollectionCompletedSales(colId, 30, { fresh: opts.fresh }),
    fetchCollectionFloor(colId).catch(() => null),
  ]);
  if (sales.length === 0) {
    try { cachePut(`comps-none:${colId}`, "1", 60 * 60); } catch { /* best effort */ } // no clean sales -> remember it
    return null;
  }

  // Most-recent sales first, capped — these dominate the recency-weighted model anyway.
  const recent = [...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, MAX_NFTS);
  const now = Date.now();

  let supply = 0; // collection size, for rank percentile + rank-distance bandwidth
  let traitFreq: TraitFreq | undefined;
  const detailList = await getNftDetailsBatch(recent.map((s) => s.id), true); // ONE MGET for cached; network only for misses
  const rows: (SaleRow | null)[] = recent.map((s, i) => {
    const d = detailList[i];
    if (!d) return null;
    const col = d.collection as { nft_count?: number; attributes_frequency_counts?: TraitFreq } | undefined;
    if (typeof col?.nft_count === "number" && col.nft_count > supply) supply = col.nft_count;
    if (!traitFreq && col?.attributes_frequency_counts) traitFreq = col.attributes_frequency_counts;
    const rank = Number(d.openrarity_rank);
    const traits = mapTraits(d).map((t) => ({ k: t.trait_type, v: String(t.value) })); // tolerant of type/name keys
    const soldAt = s.date ? new Date(s.date).getTime() : now - 365 * 86_400_000;
    // Counterparties for wash-trade defenses: the NFT's most-recent XCH sale event carries the seller
    // (previous_address) and buyer (address). Already in this payload — no extra fetch. Graceful if absent.
    const saleEvents = (d.events ?? []).filter((e) => e && e.type === 2 && typeof e.xch_price === "number" && (e.xch_price ?? 0) > 0);
    const last = saleEvents.length ? saleEvents[saleEvents.length - 1] : null;
    const seller = last?.previous_address?.encoded_id ?? undefined;
    const buyer = last?.address?.encoded_id ?? undefined;
    const num = numberFromName((d as { data?: { metadata_json?: { name?: string } } }).data?.metadata_json?.name ?? "");
    return { id: s.id, mgRank: Number.isFinite(rank) && rank > 0 ? rank : null, num, price: s.price, ageDays: (now - soldAt) / 86_400_000, soldAt, traits, seller, buyer };
  });
  const fetched = rows.filter((x): x is SaleRow => x !== null);
  if (fetched.length === 0) return null;

  // Resolve a rank per sale. Ranked collections use MintGarden\'s rank directly. For collections
  // MintGarden hasn\'t ranked, fall back to OUR own computed ranks (getCollectionFrequency) + our trait
  // table — SCALED to supply exactly like the collection cards, so the fitted curve lines up with the
  // ranks shown on screen. This is what gives unranked collections a real sale-driven curve + hot traits.
  const seed = isSeeded(colId) ? await getSeed(colId) : null;
  const haveMgRanks = fetched.some((r) => r.mgRank != null);
  let rankOf: (r: SaleRow) => number | null;
  if (seed) {
    supply = seed.supply; // seed is authoritative for a seeded collection
    if (!traitFreq) { // build the trait-frequency table from the seed so trait-demand works too
      const f: TraitFreq = {};
      for (const k in seed.byNumber) for (const [tt, v] of seed.byNumber[k].traits) {
        const cat = (f[tt.toLowerCase()] ??= {}); const val = String(v).toLowerCase();
        cat[val] = (cat[val] ?? 0) + 1;
      }
      traitFreq = f;
    }
    rankOf = (r) => (r.num != null ? seed.byNumber[String(r.num)]?.rank ?? null : null);
  } else if (haveMgRanks) {
    if (supply <= 0) supply = fetched.reduce((m, r) => Math.max(m, r.mgRank ?? 0), 0);
    rankOf = (r) => r.mgRank;
  } else {
    const freqData = await getCollectionFrequency(colId, { wait: true }).catch(() => null);
    if (!freqData || Object.keys(freqData.rankById).length === 0) return null; // can\'t rank -> no model
    const M = Object.keys(freqData.rankById).length;
    if (supply <= 0) supply = freqData.total;
    if (!traitFreq) traitFreq = freqData.freq;
    const S = supply;
    rankOf = (r) => {
      const raw = freqData.rankById[r.id];
      return raw == null ? null : Math.max(1, Math.min(S, Math.round(((raw - 0.5) / M) * S)));
    };
  }

  const usable: (({ soldAt: number } & Sale))[] = [];
  for (const r of fetched) {
    const rank = rankOf(r);
    if (rank == null) continue;
    usable.push({ rank, price: r.price, ageDays: r.ageDays, traits: r.traits, soldAt: r.soldAt, seller: r.seller, buyer: r.buyer });
  }
  if (usable.length === 0) return null;
  _newestSaleAt.set(colId, usable.reduce((m, s) => Math.max(m, s.soldAt), 0)); // watermark for the event-driven probe
  _builtAt.set(colId, now); // freshness stamp: values were just refit from live sales
  const floor = typeof floorXch === "number" ? floorXch : 0;

  // Write the INPUTS through to the DB so a cold process rehydrates instantly (no refetch).
  const persisted: PersistedComps = {
    supply, floor, traitFreq, builtAt: now,
    sales: usable.map((s) => ({ rank: s.rank, price: s.price, soldAt: s.soldAt, traits: s.traits, seller: s.seller, buyer: s.buyer })),
  };
  try { cachePut(`comps:${colId}`, JSON.stringify(persisted), 12 * 60 * 60); } catch { /* cache optional */ } // readable 6h; 12h ex

  return buildCompsModel(usable, supply, { floor, rarityFactor: rarityFactorForPercentile, traitFreq, ...adaptiveHalfLifeOptions() });
}

// Kick a network (re)build in the background, keeping the stale model live until it lands.
function kickBuild(colId: string, stale: CompsModel | null, wait?: boolean, fresh?: boolean): Promise<CompsModel | null> {
  // One build per collection across ALL instances. Previously every cold lambda kicked its own duplicate
  // build (429-storming the others, often dying before it persisted). Lock-losers return stale and pick up
  // the persisted blob on the next poll. Null results cache only briefly so we re-check the blob soon.
  const locked = (async (): Promise<CompsModel | null> => {
    const got = await tryLock(`compsbuild:${colId}`, 120).catch(() => false);
    if (!got) {
      // Another instance is building — pick up its freshly-persisted blob if it's already there.
      try { const raw = await cacheGet(`comps:${colId}`, DB_TTL); if (raw) { const m = modelFromPersisted(JSON.parse(raw) as PersistedComps); if (m) return m; } } catch { /* fall back to stale */ }
      return stale;
    }
    try { return await build(colId, { fresh }); } finally { await releaseLock(`compsbuild:${colId}`); }
  })();
  const building = locked
    .then((model) => {
      _cache.set(colId, { model, expiresAt: Date.now() + (model ? TTL : 15_000) });
      return model;
    })
    .catch(() => {
      _cache.set(colId, { model: stale, expiresAt: Date.now() + 5 * 60_000 });
      return stale;
    });
  _cache.set(colId, { model: stale, expiresAt: stale ? Date.now() + TTL : 0, building });
  keepAlive(building); // survive serverless function freeze so the comps build actually lands + persists
  return wait ? building : Promise.resolve(stale);
}

// When this collection's displayed values were last (re)built (ms epoch), or null if no model on this
// instance yet. Drives the "values as of X ago" freshness badge.
export function compsBuiltAt(colId: string): number | null { return _builtAt.get(colId) ?? null; }

// Event-driven freshness: a cheap Dexie tip-probe. If Dexie's newest completed sale is newer than the newest
// sale already baked into our model, kick a FRESH rebuild and AWAIT it — so the caller can immediately
// recompute + re-index with the new value. Throttled to one probe per collection per minute per instance;
// best-effort (any failure just returns false and the age-timer refresh still covers it). Returns true only
// when a genuinely newer sale triggered a refit.
export async function refreshCompsIfSold(colId: string): Promise<boolean> {
  if (!colId.startsWith("col1")) return false;
  const now = Date.now();
  if (now - (_lastProbe.get(colId) ?? 0) < PROBE_THROTTLE_MS) return false;
  _lastProbe.set(colId, now);
  const baseline = _newestSaleAt.get(colId);
  if (baseline == null) return false; // no model built on this instance yet — getCompsModel will build it first
  const tip = await fetchCollectionSalesTip(colId);
  if (!tip || tip.lastSaleAt <= baseline + 1000) return false; // nothing newer than what we already modeled
  const model = _cache.get(colId)?.model ?? null;
  await kickBuild(colId, model, true, true); // wait + fresh: fold in the new sale (updates _newestSaleAt) before returning
  // Stamp the watermark from the RAW tip (max-merge with whatever the build set). This guarantees each distinct
  // Dexie tip triggers at most ONE refit attempt per instance — even if that sale was filtered out of the model
  // (bundle / XCH+CAT / rank-unresolvable / detail-fetch miss) or the build lost the platform lock. Without this
  // a filtered newest sale keeps baseline < tip forever and every view re-runs a full fresh build (rebuild storm).
  // Degradation is correct: a dirty/filtered tip just surfaces via the Phase 0 age timer instead of instantly.
  _newestSaleAt.set(colId, Math.max(_newestSaleAt.get(colId) ?? 0, tip.lastSaleAt));
  return true;
}

/**
 * Returns the cached comps model if warm. On a cold miss it first tries the DB-persisted inputs — if
 * present it rehydrates and serves the full model IMMEDIATELY (and refreshes in the background if the
 * inputs are older than the memory TTL). Only when there's nothing persisted does it fall back to a
 * network build (returning null now so the caller keeps the old estimate and never blocks).
 * Pass `wait: true` only from background jobs that can afford to await the full build.
 */
// True when a recent build found NO clean sales for this collection (so no comps model will ever exist and
// callers should settle on the baseline value rather than waiting/polling).
export async function hasNoComps(colId: string): Promise<boolean> {
  try { return (await cacheGet(`comps-none:${colId}`, 60 * 60_000)) != null; } catch { return false; }
}

export async function getCompsModel(colId: string, opts: { wait?: boolean } = {}): Promise<CompsModel | null> {
  if (!colId.startsWith("col1")) return null;
  const hit = _cache.get(colId);
  if (hit && Date.now() < hit.expiresAt) return hit.model;
  if (hit?.building) return opts.wait ? hit.building : (hit.model ?? null);

  // Cold in-memory: try persisted inputs for an instant warm model before touching the network.
  if (!hit) {
    let raw: string | null = null;
    try { raw = await cacheGet(`comps:${colId}`, DB_TTL); } catch { raw = null; }
    if (raw) {
      try {
        const persisted = JSON.parse(raw) as PersistedComps;
        const model = modelFromPersisted(persisted);
        if (model) {
          _cache.set(colId, { model, expiresAt: Date.now() + TTL });
          // Seed cross-instance busyness from the persisted sale timestamps (no network) so adaptiveRefreshAge
          // and the market fetchers know this collection is hot even on a cold instance.
          recordSalesActivity(colId, persisted.sales.map((sp) => ({ date: new Date(sp.soldAt).toISOString() })));
          _newestSaleAt.set(colId, persisted.sales.reduce((m, sp) => Math.max(m, sp.soldAt), 0)); // watermark for the event-driven probe
          _builtAt.set(colId, persisted.builtAt); // freshness stamp from the persisted inputs
          // Refresh in the background once inputs age out (sooner for busy collections). fresh=true forces a
          // real Dexie pull so we fold in new sales instead of re-fitting the same cached blob.
          if (Date.now() - persisted.builtAt > adaptiveRefreshAge(colId)) void kickBuild(colId, model, false, true);
          return model;
        }
      } catch { /* corrupt blob -> network build */ }
    }
  }

  return kickBuild(colId, hit?.model ?? null, opts.wait);
}
