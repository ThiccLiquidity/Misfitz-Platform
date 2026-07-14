// Build the full list of Tang Gang collections as browse CollectionSummaries (image, floor, supply) by resolving
// each col1 id through the TTL-cached MintGarden getCollection, then sorting by peel points. The whole assembled
// list is cached (12h) so the ~338-collection build runs at most once per window, not per request.
import { getCollection } from "@/lib/data-sources/mintgarden/client";
import { mapCollectionSummary } from "@/lib/data-sources/mintgarden/map";
import { cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { TANG_COLLECTIONS } from "./tangData";
import type { CollectionSummary } from "@/types";

const KEY = "tang:collections:v1";
const TTL_MS = 12 * 60 * 60_000;
const EX_S = 12 * 60 * 60;

async function pool<T>(items: T[], limit: number, worker: (t: T) => Promise<void>): Promise<void> {
  let n = 0;
  const run = async () => { while (n < items.length) { const i = n++; await worker(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function getTangCollections(): Promise<CollectionSummary[]> {
  try { const raw = await cacheGetLarge(KEY, TTL_MS); if (raw) return JSON.parse(raw) as CollectionSummary[]; } catch { /* rebuild */ }
  const ids = Object.keys(TANG_COLLECTIONS);
  const out: CollectionSummary[] = [];
  await pool(ids, 8, async (id) => {
    const c = await getCollection(id).catch(() => null);
    if (c && c.name?.trim() && c.blocked_content !== true) out.push(mapCollectionSummary(c));
  });
  out.sort((a, b) => (TANG_COLLECTIONS[b.id]?.pp ?? 0) - (TANG_COLLECTIONS[a.id]?.pp ?? 0)); // most peel points first
  try { if (out.length) await cachePutLargeAsync(KEY, JSON.stringify(out), EX_S); } catch { /* best effort */ }
  return out;
}
