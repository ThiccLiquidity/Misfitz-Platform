import { promises as fs } from "fs";
import path from "path";
import { listCollectionNfts, getNftDetail } from "@/lib/data-sources/mintgarden/client";
import type { MgPage, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";
import { buildRankEstimator } from "@/lib/rarity/estimateRank";
import { cacheGet, cachePut, keepAlive } from "@/lib/db/nftCache";
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
  complete?: boolean; // true only when the WHOLE collection was scanned (all pages + ~all details)
}

const TTL = 45 * 60_000;
const COLD_TTL = 5 * 60_000;
const MAX_NFTS = 20000; // safety valve only — artists need the WHOLE collection ranked, so cover full sets
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
const CACHE_VERSION = 4;

type DiskShape = { freq?: CollectionFrequency["freq"]; total?: number; rankById?: Record<string, number>; builtAt?: number; version?: number };
function parseDisk(raw: string): CollectionFrequency | null {
  const j = JSON.parse(raw) as DiskShape;
  if (j?.version === CACHE_VERSION && j?.freq && typeof j.total === "number" && typeof j.builtAt === "number" && Date.now() - j.builtAt < DISK_TTL) {
    return { freq: j.freq, total: j.total, rankById: j.rankById ?? {}, complete: true };
  }
  return null;
}
async function readDisk(colId: string): Promise<CollectionFrequency | null> {
  // Shared cache first (Redis on Vercel) so the expensive whole-collection rank scan is reused across
  // ALL server instances — this is the big speedup for MintGarden-unranked collections. Then local disk.
  try { const rj = await cacheGet(`rarityfreq:${colId}`, DISK_TTL); if (rj) { const v = parseDisk(rj); if (v) return v; } } catch { /* shared cache miss */ }
  try { const raw = await fs.readFile(path.join(CACHE_DIR, `${colId}.json`), "utf8"); const v = parseDisk(raw); if (v) return v; } catch { /* no cached file yet */ }
  return null;
}
async function writeDisk(colId: string, v: CollectionFrequency): Promise<void> {
  const payload = JSON.stringify({ ...v, builtAt: Date.now(), version: CACHE_VERSION });
  try { cachePut(`rarityfreq:${colId}`, payload); } catch { /* shared cache optional */ } // Redis + local kv
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${colId}.json`), payload);
  } catch { /* disk unavailable (e.g. read-only FS) — shared cache still covers it */ }
}

async function build(colId: string): Promise<CollectionFrequency | null> {
  // 1) Persistent disk cache first — a COMPLETE scan is written once and reused for 30 days.
  const cached = await readDisk(colId);
  if (cached) return cached;

  // 2) Page the FULL id list. Retry a transiently-failed page so one hiccup can't truncate the collection
  //    (which would leave every NFT past the failure point permanently unranked).
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  let listComplete = true;
  do {
    let page: MgPage<MgListItem> | null = null;
    for (let attempt = 0; attempt < 3 && !page; attempt++) {
      page = await listCollectionNfts(colId, cursor, PAGE, true).catch(() => null);
      if (!page && attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (!page) { listComplete = false; break; }
    for (const it of page.items ?? []) { if (ids.length >= MAX_NFTS) break; if (it.id) ids.push(it.id); }
    cursor = page.next;
  } while (cursor && ids.length < MAX_NFTS);
  if (ids.length === 0) return null;

  // 3) Fetch EVERY NFT's traits, retrying transient 429s so NFTs aren't silently skipped (unranked).
  //    getNftDetail is itself cached, so a follow-up scan only re-fetches the ones that failed.
  const freq: Record<string, Record<string, number>> = {};
  const perNft: { id: string; traits: Trait[] }[] = [];
  let idx = 0;
  let detailFails = 0;
  async function worker() {
    while (idx < ids.length) {
      const i = idx++;
      const id = ids[i];
      let d = await getNftDetail(id, true, true).catch(() => null);
      for (let attempt = 1; !d && attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        d = await getNftDetail(id, true, true).catch(() => null);
      }
      if (!d) { detailFails++; continue; }
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

  // 4) Score + rank every NFT by SORTING on rarity score (rarest first) -> unique 1..N ranks.
  const estimator = buildRankEstimator(freq, perNft.length);
  const rankById: Record<string, number> = {};
  if (estimator) {
    const scored = perNft.map((nft) => ({ id: nft.id, score: estimator.scoreOf(nft.traits) }));
    scored.sort((a, b) => b.score - a.score); // highest score = rarest = rank 1
    scored.forEach((entry, i) => { rankById[entry.id] = i + 1; });
  }

  // Rank the WHOLE collection: NFTs with no scoreable traits (empty attributes) — or the rare piece whose
  // detail never fetched — can't be scored by rarity, so they land at the COMMON end (after the scored set)
  // instead of being left unranked. Deterministic (list order) so ranks are stable across rebuilds.
  let nextRank = Object.keys(rankById).length + 1;
  for (const id of ids) {
    if (rankById[id] == null) rankById[id] = nextRank++;
  }

  // Persist to the 30-day cache ONLY when the scan is complete: the whole list paged AND ~all details
  // fetched. A truncated/partial scan is used for THIS render but not frozen for 30 days — the next scan
  // (cheap, since successful details are cached) fills in the rest and then persists.
  const coverage = ids.length > 0 ? (ids.length - detailFails) / ids.length : 0;
  const complete = listComplete && coverage >= 0.97;
  const result: CollectionFrequency = { freq, total: ids.length, rankById, complete };
  if (complete) await writeDisk(colId, result);
  return result;
}

export async function getCollectionFrequency(colId: string, opts: { wait?: boolean } = {}): Promise<CollectionFrequency | null> {
  if (!colId.startsWith("col1")) return null;
  const hit = _cache.get(colId);
  if (hit && Date.now() < hit.expiresAt && !hit.building) return hit.value;
  if (hit?.building) return opts.wait ? hit.building : (hit.value ?? null);

  const building = build(colId)
    .then((v) => { _cache.set(colId, { value: v, expiresAt: Date.now() + (v ? (v.complete ? TTL : 4 * 60_000) : COLD_TTL) }); return v; })
    .catch(() => { _cache.set(colId, { value: null, expiresAt: Date.now() + COLD_TTL }); return null; });
  _cache.set(colId, { value: hit?.value ?? null, expiresAt: hit?.expiresAt ?? 0, building });
  keepAlive(building); // survive serverless function freeze so the scan actually finishes on the first visit
  return opts.wait ? building : (hit?.value ?? null);
}
