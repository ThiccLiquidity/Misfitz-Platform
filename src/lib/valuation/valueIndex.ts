// Value Index — the "portfolio at browse speed" cache. Browse (getAllCollectionCards) computes every NFT's
// final value; on a COMPLETE (non-warming) build it projects those numbers here (per-collection, keyed by
// launcherId, gzip-sharded). The portfolio LOOKS UP each held card's value and stamps it on — browse's own
// output, identical by construction, no per-NFT recompute. The valuation math is untouched.

import type { NftData } from "@/types";
import { cacheGetLarge, cachePutLargeAsync, cacheGet, cachePut } from "@/lib/db/nftCache";
import { entryOf, stampValueEntry, type ValueEntry } from "./valueEntry";

const VIDX_TTL_MS = 30 * 60_000;   // read-fresh 30 min
const VIDX_EX_S = 24 * 60 * 60;    // persist 24h
const WRITE_GATE_MS = 10 * 60_000; // rewrite a collection's index at most once per 10 min per instance
const READ_MEMO_MS = 5 * 60_000;   // one blob read per collection per ~5 min per instance

export interface ValueIndex { builtAt: number; values: Record<string, ValueEntry> }

const _lastWrite = new Map<string, number>();
// Called by the browse pipeline on a COMPLETE (non-warming) build. Fire-and-forget via keepAlive at the call site.
export async function writeValueIndex(colId: string, nfts: NftData[]): Promise<void> {
  const now = Date.now();
  if (now - (_lastWrite.get(colId) ?? 0) < WRITE_GATE_MS) return;
  _lastWrite.set(colId, now);
  const values: Record<string, ValueEntry> = {};
  for (const n of nfts) { const e = entryOf(n); if (e && n.launcherId) values[n.launcherId] = e; }
  if (Object.keys(values).length === 0) return;
  const idx: ValueIndex = { builtAt: now, values };
  try {
    await cachePutLargeAsync(`vidx:${colId}`, JSON.stringify(idx), VIDX_EX_S);
    _readMemo.set(colId, { idx, at: now }); // visible to the next poll on THIS instance immediately (no 5-min null stall)
  } catch { /* best effort */ }
}

const _readMemo = new Map<string, { idx: ValueIndex | null; at: number }>();
export async function readValueIndex(colId: string): Promise<ValueIndex | null> {
  const hit = _readMemo.get(colId);
  if (hit && Date.now() - hit.at < READ_MEMO_MS) return hit.idx;
  let idx: ValueIndex | null = null;
  try { const raw = await cacheGetLarge(`vidx:${colId}`, VIDX_TTL_MS); if (raw) idx = JSON.parse(raw) as ValueIndex; } catch { idx = null; }
  _readMemo.set(colId, { idx, at: Date.now() });
  return idx;
}

// Stamp a whole card list from the per-collection indexes (reads each collection's index once).
export async function stampCardsFromIndex(cards: NftData[], xchUsdRate: number): Promise<void> {
  const cols = [...new Set(cards.map((c) => c.collectionSlug))].filter((c) => c.startsWith("col1"));
  if (cols.length === 0) return;
  const pairs = await Promise.all(cols.map(async (c) => [c, await readValueIndex(c)] as const));
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
export async function noteWarmset(colIds: string[]): Promise<void> {
  const ids = colIds.filter((c) => c.startsWith("col1"));
  if (ids.length === 0) return;
  if (Date.now() - _warmsetNotedAt < 5 * 60_000) return; // throttle
  _warmsetNotedAt = Date.now();
  try {
    const raw = await cacheGet(WARMSET_KEY, WARMSET_TTL_MS);
    const cur: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (ids.every((c) => cur.includes(c))) return; // nothing new
    const merged = [...new Set([...ids, ...cur])].slice(0, WARMSET_MAX); // most-recently-held first
    cachePut(WARMSET_KEY, JSON.stringify(merged), WARMSET_EX_S);
  } catch { /* best effort */ }
}

export async function readWarmset(): Promise<string[]> {
  try { const raw = await cacheGet(WARMSET_KEY, WARMSET_TTL_MS); return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}
