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

import { fetchCollectionCompletedSales, fetchCollectionFloor } from "@/lib/market/dexie";
import { rarityFactorForPercentile } from "@/lib/valuation/estimate";
import { getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { buildCompsModel, type CompsModel, type Sale, type Trait } from "@/lib/valuation/comps";
import { cacheGet, cachePut } from "@/lib/db/nftCache";
import { getCollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";

interface CacheEntry { model: CompsModel | null; expiresAt: number; building?: Promise<CompsModel | null> }
const _cache = new Map<string, CacheEntry>();
const TTL = 45 * 60_000;
const DB_TTL = 6 * 60 * 60_000; // keep persisted inputs 6h; we still background-refresh once memory expires
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
  });
}

// One fetched sale before we\'ve resolved a usable rank. mgRank is MintGarden\'s rank if present, else
// null (a collection MintGarden hasn\'t ranked — we fall back to OUR computed ranks below).
interface SaleRow { id: string; mgRank: number | null; price: number; ageDays: number; soldAt: number; traits: Trait[]; seller?: string; buyer?: string }

async function build(colId: string): Promise<CompsModel | null> {
  const [sales, floorXch] = await Promise.all([
    fetchCollectionCompletedSales(colId),
    fetchCollectionFloor(colId).catch(() => null),
  ]);
  if (sales.length === 0) return null;

  // Most-recent sales first, capped — these dominate the recency-weighted model anyway.
  const recent = [...sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, MAX_NFTS);
  const now = Date.now();

  let supply = 0; // collection size, for rank percentile + rank-distance bandwidth
  let traitFreq: TraitFreq | undefined;
  const rows: (SaleRow | null)[] = await pool(recent, CONC, async (s) => {
    const d = await getNftDetail(s.id, true).catch(() => null);
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
    return { id: s.id, mgRank: Number.isFinite(rank) && rank > 0 ? rank : null, price: s.price, ageDays: (now - soldAt) / 86_400_000, soldAt, traits, seller, buyer };
  });
  const fetched = rows.filter((x): x is SaleRow => x !== null);
  if (fetched.length === 0) return null;

  // Resolve a rank per sale. Ranked collections use MintGarden\'s rank directly. For collections
  // MintGarden hasn\'t ranked, fall back to OUR own computed ranks (getCollectionFrequency) + our trait
  // table — SCALED to supply exactly like the collection cards, so the fitted curve lines up with the
  // ranks shown on screen. This is what gives unranked collections a real sale-driven curve + hot traits.
  const haveMgRanks = fetched.some((r) => r.mgRank != null);
  let rankOf: (r: SaleRow) => number | null;
  if (haveMgRanks) {
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
  const floor = typeof floorXch === "number" ? floorXch : 0;

  // Write the INPUTS through to the DB so a cold process rehydrates instantly (no refetch).
  const persisted: PersistedComps = {
    supply, floor, traitFreq, builtAt: now,
    sales: usable.map((s) => ({ rank: s.rank, price: s.price, soldAt: s.soldAt, traits: s.traits, seller: s.seller, buyer: s.buyer })),
  };
  try { cachePut(`comps:${colId}`, JSON.stringify(persisted)); } catch { /* cache optional */ }

  return buildCompsModel(usable, supply, { floor, rarityFactor: rarityFactorForPercentile, traitFreq });
}

// Kick a network (re)build in the background, keeping the stale model live until it lands.
function kickBuild(colId: string, stale: CompsModel | null, wait?: boolean): Promise<CompsModel | null> {
  const building = build(colId)
    .then((model) => {
      _cache.set(colId, { model, expiresAt: Date.now() + TTL });
      return model;
    })
    .catch(() => {
      _cache.set(colId, { model: stale, expiresAt: Date.now() + 5 * 60_000 });
      return stale;
    });
  _cache.set(colId, { model: stale, expiresAt: stale ? Date.now() + TTL : 0, building });
  return wait ? building : Promise.resolve(stale);
}

/**
 * Returns the cached comps model if warm. On a cold miss it first tries the DB-persisted inputs — if
 * present it rehydrates and serves the full model IMMEDIATELY (and refreshes in the background if the
 * inputs are older than the memory TTL). Only when there's nothing persisted does it fall back to a
 * network build (returning null now so the caller keeps the old estimate and never blocks).
 * Pass `wait: true` only from background jobs that can afford to await the full build.
 */
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
          // Refresh from the network in the background if the persisted inputs are getting old.
          if (Date.now() - persisted.builtAt > TTL) void kickBuild(colId, model);
          return model;
        }
      } catch { /* corrupt blob -> network build */ }
    }
  }

  return kickBuild(colId, hit?.model ?? null, opts.wait);
}
