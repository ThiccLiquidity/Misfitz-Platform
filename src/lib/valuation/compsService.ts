// Builds and caches the per-collection comparable-sales model. THIS is where the heavy lifting lives —
// it is intentionally kept OFF the user's request path: callers either await a warm cache or kick a
// background build and use the old estimate until the model is ready (see liveCollection).
//
// Cost model: one Dexie sales scan + up to `maxNfts` cached MintGarden detail fetches (rank + traits)
// for the most-recently-sold NFTs. Detail fetches are individually TTL-cached in the client, and the
// finished model is cached here for 45 min, so steady-state cost is ~zero. valueOf() is pure arithmetic.

import { fetchCollectionCompletedSales, fetchCollectionFloor } from "@/lib/market/dexie";
import { rarityFactorForPercentile } from "@/lib/valuation/estimate";
import { getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { buildCompsModel, type CompsModel, type Sale } from "@/lib/valuation/comps";

interface CacheEntry { model: CompsModel | null; expiresAt: number; building?: Promise<CompsModel | null> }
const _cache = new Map<string, CacheEntry>();
const TTL = 45 * 60_000;
const MAX_NFTS = 300; // cap on detail fetches for a cold build (bounds cost; recency-prioritised)
const CONC = 6;

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
  const built: (Sale | null)[] = await pool(recent, CONC, async (s) => {
    const d = await getNftDetail(s.id).catch(() => null);
    if (!d) return null;
    const cnt = (d.collection as { nft_count?: number } | undefined)?.nft_count;
    if (typeof cnt === "number" && cnt > supply) supply = cnt;
    const rank = Number(d.openrarity_rank);
    if (!Number.isFinite(rank) || rank <= 0) return null;
    const traits = (d.data?.metadata_json?.attributes ?? [])
      .filter((a) => a && a.trait_type != null && a.value != null)
      .map((a) => ({ k: String(a.trait_type), v: String(a.value) }));
    const ageDays = s.date ? (now - new Date(s.date).getTime()) / 86_400_000 : 365;
    return { rank, price: s.price, ageDays, traits };
  });

  const usable = built.filter((x): x is Sale => x !== null);
  // Fallback supply if the API didn't give nft_count: the largest rank we saw is a lower bound.
  if (supply <= 0) supply = usable.reduce((m, x) => Math.max(m, x.rank), 0);
  return buildCompsModel(usable, supply, {
    floor: typeof floorXch === "number" ? floorXch : 0,
    rarityFactor: rarityFactorForPercentile,
  });
}

/**
 * Returns the cached comps model if warm. If cold, kicks a background build and returns null NOW
 * (so the caller falls back to the old estimate and never blocks). The next request gets the model.
 * Pass `wait: true` only from background jobs that can afford to await the full build.
 */
export async function getCompsModel(colId: string, opts: { wait?: boolean } = {}): Promise<CompsModel | null> {
  if (!colId.startsWith("col1")) return null;
  const hit = _cache.get(colId);
  if (hit && Date.now() < hit.expiresAt) return hit.model;
  if (hit?.building) return opts.wait ? hit.building : (hit.model ?? null);

  const building = build(colId)
    .then((model) => {
      _cache.set(colId, { model, expiresAt: Date.now() + TTL });
      return model;
    })
    .catch(() => {
      _cache.set(colId, { model: hit?.model ?? null, expiresAt: Date.now() + 5 * 60_000 });
      return hit?.model ?? null;
    });

  // Keep serving the stale model (if any) while rebuilding.
  _cache.set(colId, { model: hit?.model ?? null, expiresAt: hit?.expiresAt ?? 0, building });
  return opts.wait ? building : (hit?.model ?? null);
}
