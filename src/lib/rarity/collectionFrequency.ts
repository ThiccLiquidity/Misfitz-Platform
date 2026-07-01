import { listCollectionNfts, getNftDetail } from "@/lib/data-sources/mintgarden/client";
import type { MgPage, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";

// Compute OUR OWN trait-frequency table for a collection MintGarden hasn't ranked (openrarity_rank +
// attributes_frequency_counts both null) but whose NFTs DO carry CHIP-0007 traits (e.g. the "NFT"
// collection). We page the whole collection, tally each trait value from the per-NFT details, and
// return the same shape MintGarden would ({type(lowercased): {value(lowercased): count}}). Injecting
// this into a detail's collection lets the existing rank estimator + trait-rarity math work unchanged.
//
// Cached per collection, built in the BACKGROUND (returns null on a cold cache) so it never blocks a
// request. Capped for huge collections. Returns null when the collection genuinely has no traits.
export interface CollectionFrequency {
  freq: Record<string, Record<string, number>>;
  total: number;
}

const TTL = 45 * 60_000;
const COLD_TTL = 5 * 60_000;
const MAX_NFTS = 2000; // cap the scan; beyond this we skip (too costly to self-rank live)
const PAGE = 100;
const CONC = 8;

interface Entry { value: CollectionFrequency | null; expiresAt: number; building?: Promise<CollectionFrequency | null> }
const _cache = new Map<string, Entry>();

async function build(colId: string): Promise<CollectionFrequency | null> {
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: MgPage<MgListItem> = await listCollectionNfts(colId, cursor, PAGE).catch(() => ({ items: [], next: null, previous: null }));
    for (const it of page.items ?? []) { if (ids.length >= MAX_NFTS) break; if (it.id) ids.push(it.id); }
    cursor = page.next;
  } while (cursor && ids.length < MAX_NFTS);
  if (ids.length === 0) return null;

  const freq: Record<string, Record<string, number>> = {};
  let withTraits = 0;
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const d = await getNftDetail(ids[idx++]).catch(() => null);
      if (!d) continue;
      const traits = mapTraits(d);
      if (traits.length === 0) continue;
      withTraits += 1;
      for (const t of traits) {
        const type = t.trait_type.toLowerCase();
        const val = String(t.value).toLowerCase();
        const group = (freq[type] ??= {});
        group[val] = (group[val] ?? 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, ids.length) }, worker));
  if (withTraits === 0) return null; // no traits anywhere -> nothing to rank by
  return { freq, total: ids.length };
}

export async function getCollectionFrequency(colId: string, opts: { wait?: boolean } = {}): Promise<CollectionFrequency | null> {
  if (!colId.startsWith("col1")) return null;
  const hit = _cache.get(colId);
  if (hit && Date.now() < hit.expiresAt && !hit.building) return hit.value;
  if (hit?.building) return opts.wait ? hit.building : (hit.value ?? null);

  const building = build(colId)
    .then((v) => { _cache.set(colId, { value: v, expiresAt: Date.now() + (v ? TTL : COLD_TTL) }); return v; })
    .catch(() => { _cache.set(colId, { value: null, expiresAt: Date.now() + COLD_TTL }); return null; });
  _cache.set(colId, { value: hit?.value ?? null, expiresAt: hit?.expiresAt ?? 0, building });
  return opts.wait ? building : (hit?.value ?? null);
}
