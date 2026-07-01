import { promises as fs } from "fs";
import path from "path";
import { listCollectionNfts, getNftDetail } from "@/lib/data-sources/mintgarden/client";
import type { MgPage, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";
import { buildRankEstimator } from "@/lib/rarity/estimateRank";
import type { Trait } from "@/types";

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
  rankById: Record<string, number>; // hex NFT id -> our estimated OpenRarity rank (1 = rarest)
}

const TTL = 45 * 60_000;
const COLD_TTL = 5 * 60_000;
const MAX_NFTS = 2000; // cap the scan; beyond this we skip (too costly to self-rank live)
const PAGE = 100;
const CONC = 8;

interface Entry { value: CollectionFrequency | null; expiresAt: number; building?: Promise<CollectionFrequency | null> }
const _cache = new Map<string, Entry>();

// ── Persistent disk cache ─────────────────────────────────────────────────────
// The expensive part (fetching EVERY NFT's traits from MintGarden) should happen ONCE per collection,
// ever — not on every server restart. We persist the computed table to disk so a restart loads it
// instantly instead of re-scanning the whole collection. NFT traits never change, so this is safe;
// a 30-day TTL lets us pick up any new mints. (A single-server disk cache; swap for shared storage
// when going multi-instance.)
const CACHE_DIR = path.join(process.cwd(), ".rarity-cache");
const DISK_TTL = 30 * 24 * 60 * 60_000;
// Bump when the ranking ALGORITHM changes so old cache files are ignored + rebuilt. v1 used a
// percentile estimate that tied many NFTs at the same rank (dozens all "rank #1"); v2 sorts every
// NFT by score for unique 1..N ranks. Without this bump the stale v1 file keeps serving bad ranks.
const CACHE_VERSION = 2;

async function readDisk(colId: string): Promise<CollectionFrequency | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${colId}.json`), "utf8");
    const j = JSON.parse(raw) as { freq?: CollectionFrequency["freq"]; total?: number; rankById?: Record<string, number>; builtAt?: number; version?: number };
    if (j?.version === CACHE_VERSION && j?.freq && typeof j.total === "number" && typeof j.builtAt === "number" && Date.now() - j.builtAt < DISK_TTL) {
      return { freq: j.freq, total: j.total, rankById: j.rankById ?? {} };
    }
  } catch { /* no cached file yet */ }
  return null;
}
async function writeDisk(colId: string, v: CollectionFrequency): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${colId}.json`), JSON.stringify({ ...v, builtAt: Date.now(), version: CACHE_VERSION }));
  } catch { /* disk unavailable (e.g. read-only FS) — fall back to in-memory only */ }
}

async function build(colId: string): Promise<CollectionFrequency | null> {
  // 1) Persistent disk cache first — a restart shouldn't re-scan the whole collection.
  const cached = await readDisk(colId);
  if (cached) return cached;
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page: MgPage<MgListItem> = await listCollectionNfts(colId, cursor, PAGE, true).catch(() => ({ items: [], next: null, previous: null }));
    for (const it of page.items ?? []) { if (ids.length >= MAX_NFTS) break; if (it.id) ids.push(it.id); }
    cursor = page.next;
  } while (cursor && ids.length < MAX_NFTS);
  if (ids.length === 0) return null;

  const freq: Record<string, Record<string, number>> = {};
  const perNft: { id: string; traits: Trait[] }[] = [];
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const i = idx++;
      const id = ids[i];
      const d = await getNftDetail(id, true).catch(() => null);
      if (!d) continue;
      const traits = mapTraits(d);
      if (traits.length === 0) continue;
      perNft.push({ id, traits });
      for (const t of traits) {
        const type = t.trait_type.toLowerCase();
        const val = String(t.value).toLowerCase();
        const group = (freq[type] ??= {});
        group[val] = (group[val] ?? 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, ids.length) }, worker));
  if (perNft.length === 0) return null; // no traits anywhere -> nothing to rank by

  // Now that we have the whole-collection frequency table, score + rank every NFT ourselves.
  // IMPORTANT: rank by SORTING all NFTs by rarity score (rarest first) and assigning sequential 1..N
  // ranks. The estimator's percentile-based rankOf() ties many NFTs at the same rank (they share trait
  // combos), which made the tier COUNTS nonsensical (rare/uncommon bigger than common, too many mythic).
  // A proper sort gives a clean 1..N spread, so each tier band gets its correct share.
  const estimator = buildRankEstimator(freq, perNft.length);
  const rankById: Record<string, number> = {};
  if (estimator) {
    const scored = perNft.map((nft) => ({ id: nft.id, score: estimator.scoreOf(nft.traits) }));
    scored.sort((a, b) => b.score - a.score); // highest score = rarest = rank 1
    scored.forEach((entry, i) => { rankById[entry.id] = i + 1; });
  }

  const result: CollectionFrequency = { freq, total: ids.length, rankById };
  await writeDisk(colId, result); // persist so the slow scan happens exactly once, ever
  return result;
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
