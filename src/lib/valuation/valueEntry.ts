// Pure, client-safe value-entry shape + stamp. Split out of valueIndex.ts (which pulls in server-only cache
// code) so BOTH the server (index writer/reader) and the browser (portfolio convergence poll) can use it.
// Imports only computeDealScore (pure) + types.

import type { NftData } from "@/types";
import { computeDealScore } from "@/lib/rarity/enrich";

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

export function entryOf(n: NftData): ValueEntry | null {
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

// Stamp a browse value entry onto a card: override totalEstimate (+USD at the CURRENT rate), rank, and the
// comps display fields; recompute the deal score if listed; synthesize a fairValue if the card had none.
export function stampValueEntry(card: NftData, e: ValueEntry, xchUsdRate: number): void {
  const usd = Math.round(e.est * xchUsdRate * 100) / 100;
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
