import { promises as fs } from "fs";
import path from "path";
import { listCollectionNfts } from "@/lib/data-sources/mintgarden/client";
import type { MgPage, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { mapListItemTraits } from "@/lib/data-sources/mintgarden/map";
import { buildRankEstimator } from "@/lib/rarity/estimateRank";
import { cacheGetLarge, cachePutLargeAsync, keepAlive, tryLock } from "@/lib/db/nftCache";
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
const SLIM_TTL = 30 * 24 * 60 * 60_000; // must match liveCollection SLIMLIST_TTL_MS (shared roster)

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
  try { const rj = await cacheGetLarge(`rarityfreq:${colId}`, DISK_TTL); if (rj) { const v = parseDisk(rj); if (v) return v; } } catch { /* shared cache miss */ }
  try { const raw = await fs.readFile(path.join(CACHE_DIR, `${colId}.json`), "utf8"); const v = parseDisk(raw); if (v) return v; } catch { /* no cached file yet */ }
  return null;
}
async function writeDisk(colId: string, v: CollectionFrequency): Promise<void> {
  const payload = JSON.stringify({ ...v, builtAt: Date.now(), version: CACHE_VERSION });
  try { await cachePutLargeAsync(`rarityfreq:${colId}`, payload); } catch { /* shared cache optional */ } // gzip+sharded (a 10k rankById is >1MB raw)
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${colId}.json`), payload);
  } catch { /* disk unavailable (e.g. read-only FS) — shared cache still covers it */ }
}

async function build(colId: string): Promise<CollectionFrequency | null> {
  // 1) Persistent cache first — a COMPLETE scan is written once and reused for 30 days.
  const cached = await readDisk(colId);
  if (cached) return cached;

  // 2) Prefer the already-scanned collection ROSTER (cached with inline attributes via include_metadata),
  //    so rarity is a ZERO-network by-product of the collection-page scan. Only if no roster exists do we
  //    page the collection ourselves — WITH metadata, so traits arrive inline (~100 list calls, not 10k
  //    detail fetches). A cross-instance lock stops N cold instances scanning the same collection at once.
  let items: MgListItem[] | null = await loadRosterItems(colId);
  let listComplete = true;

  if (!items) {
    if (!(await tryLock(`rarity:${colId}`, 90))) return null; // someone else is scanning -> warming
    const scanned: MgListItem[] = [];
    let cursor: string | null | undefined = undefined;
    do {
      let page: MgPage<MgListItem> | null = null;
      for (let attempt = 0; attempt < 3 && !page; attempt++) {
        page = await listCollectionNfts(colId, cursor, PAGE, true, true).catch(() => null); // background + include_metadata
        if (!page && attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      if (!page) { listComplete = false; break; }
      for (const it of page.items ?? []) { if (scanned.length >= MAX_NFTS) break; if (it.id) scanned.push(it); }
      cursor = page.next;
    } while (cursor && scanned.length < MAX_NFTS);
    items = scanned;
  }
  if (!items || items.length === 0) return null;

  // 3) Tally trait frequency + per-NFT traits from the inline attributes — no per-NFT detail fetches.
  const freq: Record<string, Record<string, number>> = {};
  const perNft: { id: string; traits: Trait[] }[] = [];
  for (const it of items) {
    if (!it.id) continue;
    const traits = mapListItemTraits(it);
    if (traits.length === 0) continue;
    perNft.push({ id: it.id, traits });
    for (const t of traits) {
      const type = t.trait_type.toLowerCase();
      const val = String(t.value).toLowerCase();
      const group = (freq[type] ??= {});
      group[val] = (group[val] ?? 0) + 1;
    }
  }
  if (perNft.length === 0) return null; // collection carries no attributes -> nothing to rank by

  // 4) Score + rank by SORTING on rarity score (rarest first) -> unique 1..N ranks. (Scoring unchanged.)
  const estimator = buildRankEstimator(freq, perNft.length);
  const rankById: Record<string, number> = {};
  if (estimator) {
    const scored = perNft.map((nft) => ({ id: nft.id, score: estimator.scoreOf(nft.traits) }));
    scored.sort((a, b) => b.score - a.score);
    scored.forEach((entry, i) => { rankById[entry.id] = i + 1; });
  }
  // Whole-collection rank: traitless NFTs land at the COMMON end (deterministic list order), never unranked.
  let nextRank = Object.keys(rankById).length + 1;
  for (const it of items) { if (it.id && rankById[it.id] == null) rankById[it.id] = nextRank++; }

  const complete = listComplete;
  const result: CollectionFrequency = { freq, total: items.length, rankById, complete };
  if (complete) await writeDisk(colId, result);
  return result;
}

// Read the cached collection roster (written by liveCollection.buildBaseCollection with include_metadata)
// and return its items only if they carry inline attributes — else null so we fall back to our own scan.
async function loadRosterItems(colId: string): Promise<MgListItem[] | null> {
  try {
    const raw = await cacheGetLarge(`slimlist2:${colId}`, SLIM_TTL);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { items?: MgListItem[] };
    const items = parsed.items ?? [];
    if (items.length === 0) return null;
    const hasTraits = items.some((it) => (it.metadata?.attributes?.length ?? 0) > 0);
    return hasTraits ? items : null;
  } catch { return null; }
}

// waitMs: wait UP TO this long for the (usually cache-backed) build to resolve, else fall back to the last
// value/null — lets the wallet read an already-cached rank table (one fast Redis round-trip) without
// blocking on a cold FULL scan (which races out to null and keeps building in the background).
export async function getCollectionFrequency(colId: string, opts: { wait?: boolean; waitMs?: number } = {}): Promise<CollectionFrequency | null> {
  if (!colId.startsWith("col1")) return null;
  const hit = _cache.get(colId);
  if (hit && Date.now() < hit.expiresAt && !hit.building) return hit.value;
  const raced = (p: Promise<CollectionFrequency | null>, fb: CollectionFrequency | null): Promise<CollectionFrequency | null> =>
    opts.waitMs ? Promise.race([p, new Promise<CollectionFrequency | null>((r) => setTimeout(() => r(fb), opts.waitMs))]) : Promise.resolve(fb);
  if (hit?.building) return opts.wait ? hit.building : raced(hit.building, hit.value ?? null);

  const building = build(colId)
    .then((v) => { _cache.set(colId, { value: v, expiresAt: Date.now() + (v ? (v.complete ? TTL : 4 * 60_000) : COLD_TTL) }); return v; })
    .catch(() => { _cache.set(colId, { value: null, expiresAt: Date.now() + COLD_TTL }); return null; });
  _cache.set(colId, { value: hit?.value ?? null, expiresAt: hit?.expiresAt ?? 0, building });
  keepAlive(building); // survive serverless function freeze so the scan actually finishes on the first visit
  return opts.wait ? building : raced(building, hit?.value ?? null);
}

// The scaled rank used by BOTH the collection page and the wallet so they show the SAME rank for an NFT.
// Our ranks run 1..M over the NFTs we could rank; scale to the display supply so rank/supply is the true
// percentile within the ranked set (each tier gets its share). null if this NFT wasn't ranked.
export function scaledRankOf(rarity: CollectionFrequency, id: string, supply: number): number | null {
  const r = rarity.rankById[id];
  if (r == null) return null;
  const M = Object.keys(rarity.rankById).length;
  if (M <= 0 || supply <= 0) return null;
  return Math.max(1, Math.min(supply, Math.round(((r - 0.5) / M) * supply)));
}
