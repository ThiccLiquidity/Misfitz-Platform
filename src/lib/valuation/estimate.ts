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

// Whole-NFT rarity premium as a multiple of floor, by rank percentile in PERCENT (lower = rarer).
// A SMOOTH curve (not steps): nearly flat across the commons, then progressively steeper toward the
// elite end. Calibrated through tier anchors and log-interpolated between them, so there are no jumps
// at tier boundaries and value rises continuously with rarity.
const RARITY_ANCHORS: [number, number][] = [
  [0.1, 14],  // mythic — grail
  [0.5, 7],   // legendary
  [2.5, 2.0], // epic
  [10, 0.8],  // rare
  [30, 0.2],  // uncommon
  [50, 0],    // commons sit at the floor
  [100, 0],
];
export function rarityFactorForPercentile(percentile: number): number {
  const p = Math.max(0.0001, Math.min(100, percentile));
  if (p <= RARITY_ANCHORS[0][0]) return RARITY_ANCHORS[0][1]; // rarer than the top anchor -> cap
  for (let i = 1; i < RARITY_ANCHORS.length; i++) {
    const [plo, rlo] = RARITY_ANCHORS[i - 1];
    const [phi, rhi] = RARITY_ANCHORS[i];
    if (p <= phi) {
      const t = (Math.log(p) - Math.log(plo)) / (Math.log(phi) - Math.log(plo));
      return rlo + t * (rhi - rlo); // log-linear interpolation -> smooth, monotonic
    }
  }
  return 0;
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
