// Value Index — the "portfolio at browse speed" cache. The BROWSE pipeline (getAllCollectionCards) already
// computes every NFT's final value; when it finishes a NON-warming build it projects those numbers into a
// per-collection index here. The PORTFOLIO then just LOOKS UP each held card's value and stamps it on — no
// per-NFT detail fetch, no comps wait, and the value is browse's own output (identical by construction).
//
// Keyed by launcherId (the nft1… id both the browse card and the wallet card reliably carry). Stored as one
// gzip-sharded blob per collection (reuses cacheGetLarge/cachePutLargeAsync), read once per collection per
// request (in-proc memoized). The valuation math (comps.ts / estimate.ts) is untouched — we only copy + read.

import type { NftData } from "@/types";
import { cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { computeDealScore } from "@/lib/rarity/enrich";

const VIDX_TTL_MS = 30 * 60_000;      // read-fresh 30 min
const VIDX_EX_S = 24 * 60 * 60;       // persist 24h
const WRITE_GATE_MS = 10 * 60_000;    // don't rewrite a collection's index more than once per 10 min (per instance)
const READ_MEMO_MS = 5 * 60_000;      // one blob read per collection per ~5 min per instance

// The value-relevant fields copied from a browse-computed card (small: numbers + short strings).
export interface ValueEntry {
  est: number;              // fairValue.totalEstimate (the headline number)
  rank: number | null;
  rankEst?: boolean;
  score: number | null;     // rarityScore
  basis?: string | null;    // valueBasis (presence => "market curve" display)
  conf?: number | null;
  curve?: number | null;
  traitMult?: number | null;
  traitTop?: string | null;
  sample?: number | null;
}
interface ValueIndex { builtAt: number; values: Record<string, ValueEntry> }

function entryOf(n: NftData): ValueEntry | null {
  if (!n.fairValue) return null;
  return {
    est: n.fairValue.totalEstimate,
    rank: n.rarityRank,
    rankEst: n.rankEstimated,
    score: n.rarityScore,
    basis: n.valueBasis ?? null,
    conf: n.valueConfidence ?? null,
    curve: n.valueCurve ?? null,
    traitMult: n.valueTraitMult ?? null,
    traitTop: n.valueTraitTop ?? null,
    sample: n.valueSampleSize ?? null,
  };
}

const _lastWrite = new Map<string, number>();
// Called by the browse pipeline on a COMPLETE (non-warming) build. Fire-and-forget via keepAlive at the call site.
export async function writeValueIndex(colId: string, nfts: NftData[]): Promise<void> {
  const now = Date.now();
  if (now - (_lastWrite.get(colId) ?? 0) < WRITE_GATE_MS) return;
  _lastWrite.set(colId, now);
  const values: Record<string, ValueEntry> = {};
  for (const n of nfts) { const e = entryOf(n); if (e && n.launcherId) values[n.launcherId] = e; }
  if (Object.keys(values).length === 0) return;
  try { await cachePutLargeAsync(`vidx:${colId}`, JSON.stringify({ builtAt: now, values } as ValueIndex), VIDX_EX_S); } catch { /* best effort */ }
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

// Stamp a browse value entry onto a held card: override totalEstimate (+ USD at the CURRENT rate), rank,
// and the comps display fields, and recompute the deal score if the card is listed. Everything else on the
// card (traits, image, listing) is left as-is.
export function stampValueEntry(card: NftData, e: ValueEntry, xchUsdRate: number): void {
  const usd = Math.round(e.est * xchUsdRate * 100) / 100;
  // Override the browse total (+USD at the current rate). If the card never got a fair value (floor-less
  // collection in the fast path), synthesize a minimal one from the browse number so it still shows a value.
  card.fairValue = card.fairValue
    ? { ...card.fairValue, totalEstimate: e.est, totalEstimateUsd: usd }
    : { floorValue: e.est, rarityPremium: 0, traitPremium: 0, historicalSalesPremium: null, demandPremium: null, rewardValue: null, totalEstimate: e.est, totalEstimateUsd: usd, estimatedAt: new Date().toISOString() };
  card.rarityRank = e.rank;
  if (e.rankEst !== undefined) card.rankEstimated = e.rankEst;
  card.rarityScore = e.score;
  card.valueBasis = e.basis;
  card.valueConfidence = e.conf;
  card.valueCurve = e.curve;
  card.valueTraitMult = e.traitMult;
  card.valueTraitTop = e.traitTop;
  card.valueSampleSize = e.sample;
  if (card.listing && card.listing.priceXch > 0) card.dealScore = computeDealScore(e.est, card.listing.priceXch);
}

// Convenience: stamp a whole card list from the per-collection indexes (reads each collection's index once).
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
