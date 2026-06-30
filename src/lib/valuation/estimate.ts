import type { FairValueEstimate } from "@/types";

// ──────────────────────────────────────────────────────────────────────────
// Fair-value estimator (VALUATION.md Part 3). Explainable, component-based.
//
//   estimate = robustFloor + rarityPremium + desirabilityPremium ( + traitDemand, later )
//
// No standalone *trait-rarity* premium: OpenRarity rank already encodes trait rarity, so adding one
// would double-count and overprice rare NFTs. `traitPremium` is reserved (0 for now) for the
// dynamic trait-demand/reputation signal, which needs the sales-history feed.
// ──────────────────────────────────────────────────────────────────────────

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Whole-NFT rarity premium as a multiple of floor, by rank percentile (lower = rarer). Tier-aligned
// and steep at the elite end (grails are worth many multiples of floor); commons sit at floor.
// Stepwise + explainable; these multipliers are the main valuation dial.
export function rarityFactorForPercentile(percentile: number): number {
  // Tier-aligned (mythic 0.1% · legendary 0.5% · epic 2.5% · rare 10% · uncommon 30% · common).
  // Steep at the very top: grails (mythic/legendary) command a large multiple of floor, while the
  // bulk of a collection sits at/near floor. Commons get no premium (they ARE the floor tier).
  if (percentile <= 0.1) return 14;   // mythic — grail
  if (percentile <= 0.5) return 7;    // legendary
  if (percentile <= 2.5) return 2.0;  // epic
  if (percentile <= 10)  return 0.8;  // rare
  if (percentile <= 30)  return 0.2;  // uncommon
  return 0;                           // common -> sits at the floor
}

// Median of the cheapest `k` active asks — a robust floor that one troll/fat-finger listing can't
// move (VALUATION.md Part 3). Returns null when there are no asks.
export function robustFloor(askPricesXch: number[], k = 5): number | null {
  const asks = askPricesXch.filter((p) => typeof p === "number" && p > 0).sort((a, b) => a - b);
  if (asks.length === 0) return null;
  const sample = asks.slice(0, k);
  const mid = Math.floor(sample.length / 2);
  const median = sample.length % 2 ? sample[mid] : (sample[mid - 1] + sample[mid]) / 2;
  return round(median);
}

export interface EstimateInput {
  floorXch: number; // robust collection floor in XCH (>= 0)
  rarityRank: number | null; // 1-indexed whole-NFT rank; null = unranked
  totalSupply: number; // collection size, for percentile
  desirabilityWeight?: number; // special-number tier weight (× floor); 0 if not special
  xchUsdRate: number; // XCH→USD for the USD field
}

// Returns null when there's no floor to anchor on — we show "no estimate" rather than a fake 0.
export function estimateFairValue(input: EstimateInput): FairValueEstimate | null {
  const { floorXch, rarityRank, totalSupply, desirabilityWeight = 0, xchUsdRate } = input;
  if (!(floorXch > 0)) return null;

  const floorValue = round(floorXch);

  const percentile =
    rarityRank && totalSupply > 0 ? clamp((rarityRank / totalSupply) * 100, 0, 100) : 50;
  const rarityPremium = round(floorValue * rarityFactorForPercentile(percentile));

  const desirabilityPremium = round(floorValue * clamp(desirabilityWeight, 0, 1));

  const totalEstimate = round(floorValue + rarityPremium + desirabilityPremium);

  return {
    floorValue,
    rarityPremium,
    traitPremium: 0, // reserved for dynamic trait demand/reputation (needs sales feed)
    desirabilityPremium,
    historicalSalesPremium: null,
    demandPremium: null,
    rewardValue: null,
    totalEstimate,
    totalEstimateUsd: round(totalEstimate * xchUsdRate),
    estimatedAt: new Date().toISOString(),
  };
}
