// Value Index — the "portfolio at browse speed" cache. Browse (getAllCollectionCards) computes every NFT's
// final value; on a COMPLETE (non-warming) build it projects those numbers here (per-collection, keyed by
// launcherId, gzip-sharded). The portfolio LOOKS UP each held card's value and stamps it on — browse's own
// output, identical by construction, no per-NFT recompute. The valuation math is untouched.

import type { NftData } from "@/types";
import { cacheGetLarge, cachePutLargeAsync, cacheGet, cachePut } from "@/lib/db/nftCache";
import { entryOf, stampValueEntry, type ValueEntry } from "./valueEntry";

const VIDX_FRESH_MS = 30 * 60_000;      // "fresh": older than this, callers kick a background rebuild
const VIDX_READ_MS = 24 * 60 * 60_000;  // serve-stale window (= persist window): a stale comps value >> a floor baseline
const VIDX_EX_S = 24 * 60 * 60;    // persist 24h
const WRITE_GATE_MS = 10 * 60_000; // rewrite a collection's index at most once per 10 min per instance
const READ_MEMO_MS = 5 * 60_000;   // one blob read per collection per ~5 min per instance

export interface ValueIndex { builtAt: number; values: Record<string, ValueEntry> }
export function vidxIsFresh(idx: ValueIndex): boolean { return Date.now() - idx.builtAt < VIDX_FRESH_MS; }

const _lastWrite = new Map<string, number>();
// Called by the browse pipeline on a COMPLETE (non-warming) build. Fire-and-forget via keepAlive at the call site.
export async function writeValueIndex(colId: string, nfts: NftData[], opts: { force?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (!opts.force && now - (_lastWrite.get(colId) ?? 0) < WRITE_GATE_MS) return; // force: an event-driven refit rewrites NOW

  _lastWrite.set(colId, now);
  const values: Record<string, ValueEntry> = {};
  for (const n of nfts) { const e = entryOf(n); if (e && n.launcherId) values[n.launcherId] = e; }
  // Guard on CARDS, not valued entries: a complete build that yields zero values (e.g. a now-unpriced
  // troll-floored collection) must still WRITE to overwrite a stale poisoned index. Only skip on no cards
  // (a MintGarden hiccup returns []), which must never clobber a good index.
  if (nfts.length === 0) return;
  const idx: ValueIndex = { builtAt: now, values };
  try {
    await cachePutLargeAsync(`vidx:${colId}`, JSON.stringify(idx), VIDX_EX_S);
    memoSet(colId, idx, now); // visible to the next poll on THIS instance immediately (no 5-min null stall)
  } catch { /* best effort */ }
}

// Capped + evicting. This was an unbounded Map that only checked AGE on reuse and never deleted, so every
// collection any wallet had ever held stayed resident for the life of the instance — each one a whole
// parsed value index. On the heaviest route in the app that is how an instance walks itself into an OOM.
const READ_MEMO_CAP = 60;
const _readMemo = new Map<string, { idx: ValueIndex | null; at: number }>();
function memoSet(colId: string, idx: ValueIndex | null, at: number): void {
  _readMemo.delete(colId); // re-insert so Map iteration order is true LRU-by-write
  _readMemo.set(colId, { idx, at });
  while (_readMemo.size > READ_MEMO_CAP) {
    const oldest = _readMemo.keys().next().value;
    if (oldest === undefined) break;
    _readMemo.delete(oldest);
  }
}
export async function readValueIndex(colId: string): Promise<ValueIndex | null> {
  const hit = _readMemo.get(colId);
  if (hit && Date.now() - hit.at < (hit.idx ? READ_MEMO_MS : 30_000)) return hit.idx;
  let idx: ValueIndex | null = null;
  try { const raw = await cacheGetLarge(`vidx:${colId}`, VIDX_READ_MS); if (raw) idx = JSON.parse(raw) as ValueIndex; } catch { idx = null; }
  memoSet(colId, idx, Date.now());
  return idx;
}

// Stamp a whole card list from the per-collection indexes (reads each collection's index once).
// WAVE = 6, not "all of them". This fired one blob read per DISTINCT HELD COLLECTION simultaneously — 30+
// on a real wallet — each a gunzip + JSON.parse of a whole-collection value index. That is the identical
// peak-memory pattern that was bounded in artifactStamp (STAMP_WAVE); this call sits one line earlier in
// the same SSR block and was missed. Peak memory is what gets a lambda killed.
const INDEX_WAVE = 6;

export async function stampCardsFromIndex(cards: NftData[], xchUsdRate: number): Promise<void> {
  const cols = [...new Set(cards.map((c) => c.collectionSlug))].filter((c) => c.startsWith("col1"));
  if (cols.length === 0) return;
  const pairs: (readonly [string, ValueIndex | null])[] = [];
  for (let i = 0; i < cols.length; i += INDEX_WAVE) {
    pairs.push(...await Promise.all(cols.slice(i, i + INDEX_WAVE).map(async (c) => [c, await readValueIndex(c)] as const)));
  }
  const byCol = new Map(pairs);
  for (const card of cards) {
    const e = byCol.get(card.collectionSlug)?.values[card.launcherId];
    if (e) stampValueEntry(card, e, xchUsdRate);
  }
}

// ── Warmset (Phase 4): the set of collections real wallets hold, so the nightly cron pre-warms them ───────
const WARMSET_KEY = "warmset";
const WARMSET_TTL_MS = 30 * 24 * 60 * 60_000;
const WARMSET_EX_S = 30 * 24 * 60 * 60;
const WARMSET_MAX = 300;
let _warmsetNotedAt = 0;

// Best-effort: fold the collections this wallet holds into the warmset (read-merge-write, throttled per
// instance). Call in the background (keepAlive).
// FREQUENCY-WEIGHTED, not recency-first. The old version did `[...new Set([...ids, ...cur])].slice(0, 300)`,
// putting the newest ids FIRST — so a single unauthenticated visit from a wallet holding 300 junk collections
// evicted every real collection from the warm set for 30 days, and the nightly cron then spent its whole
// budget warming the attacker's collections. Now each collection carries a count of how many distinct wallet
// visits have held it, and we keep the top N BY COUNT: an established collection can't be displaced by a
// one-off wallet, and a genuinely popular new collection still climbs in naturally over repeat visits.
type WarmsetDoc = { v: 2; counts: Record<string, number> };

function parseWarmset(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as string[] | WarmsetDoc;
    // Legacy format was a bare string[]; seed each at 1 so nothing is lost on the first write.
    if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((id) => [id, 1]));
    return parsed?.counts && typeof parsed.counts === "object" ? parsed.counts : {};
  } catch { return {}; }
}

export async function noteWarmset(colIds: string[]): Promise<void> {
  const ids = [...new Set(colIds.filter((c) => c.startsWith("col1")))]; // one vote per collection per wallet
  if (ids.length === 0) return;
  if (Date.now() - _warmsetNotedAt < 5 * 60_000) return; // throttle
  _warmsetNotedAt = Date.now();
  try {
    const counts = parseWarmset(await cacheGet(WARMSET_KEY, WARMSET_TTL_MS));
    for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, WARMSET_MAX);
    cachePut(WARMSET_KEY, JSON.stringify({ v: 2, counts: Object.fromEntries(top) } satisfies WarmsetDoc), WARMSET_EX_S);
  } catch { /* best effort */ }
}

// Returned most-held-first, so even a partly-polluted warmset warms the collections real wallets actually
// hold before it ever reaches a one-off entry.
export async function readWarmset(): Promise<string[]> {
  try {
    const counts = parseWarmset(await cacheGet(WARMSET_KEY, WARMSET_TTL_MS));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  } catch { return []; }
}
