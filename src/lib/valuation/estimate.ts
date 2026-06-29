import type { FairValueEstimate } from "@/types";

// ──────────────────────────────────────────────────────────────────────────
// Explainable fair-value estimator (v1 heuristic).
//
// Product requirement: every NFT shows an estimate broken into components, never a mystery
// number (ARCHITECTURE.md Product Vision / §3 FairValueEstimate). For *live* NFTs there are no
// DB-stored premiums (those only exist for curated/seeded collections), so we derive them here
// from data MintGarden already provides: the collection floor, the NFT's whole-collection rarity
// rank, and per-trait rarity. This is intentionally simple and tunable — a transparent starting
// point, not a final pricing model. All premiums scale off the floor so the estimate degrades
// gracefully for cheap collections and never invents absolute prices out of thin air.
// ──────────────────────────────────────────────────────────────────────────

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Whole-NFT rarity premium as a multiple of floor, by rank percentile (lower = rarer).
// Stepwise + explainable: a top-1% NFT is worth a large multiple of floor, a median one barely
// above floor.
export function rarityFactorForPercentile(percentile: number): number {
  if (percentile <= 1) return 4.0;
  if (percentile <= 5) return 2.0;
  if (percentile <= 10) return 1.0;
  if (percentile <= 25) return 0.4;
  if (percentile <= 50) return 0.15;
  return 0.05;
}

// Per-trait premium factor by how rare that trait value is (% of collection that has it).
export function traitFactorForRarity(rarityPercent: number): number {
  if (rarityPercent <= 1) return 0.5;
  if (rarityPercent <= 5) return 0.25;
  if (rarityPercent <= 10) return 0.1;
  if (rarityPercent <= 25) return 0.03;
  return 0;
}

export interface EstimateInput {
  floorXch: number; // collection floor in XCH (>= 0)
  rarityRank: number | null; // 1-indexed whole-NFT rank; null = unranked
  totalSupply: number; // collection size, for percentile
  traitRarityPercents: number[]; // each trait's % of collection (0-100); rarer = smaller
  xchUsdRate: number; // XCH→USD for the USD field
}

// Returns null when there's no floor to anchor on — we'd rather show "no estimate" than a fake 0.
export function estimateFairValue(input: EstimateInput): FairValueEstimate | null {
  const { floorXch, rarityRank, totalSupply, traitRarityPercents, xchUsdRate } = input;
  if (!(floorXch > 0)) return null;

  const floorValue = round(floorXch);

  const percentile =
    rarityRank && totalSupply > 0 ? clamp((rarityRank / totalSupply) * 100, 0, 100) : 50;
  const rarityPremium = round(floorValue * rarityFactorForPercentile(percentile));

  // Sum per-trait factors, capped so a single NFT with many rare traits can't run away.
  const traitFactorSum = clamp(
    traitRarityPercents.reduce((sum, p) => sum + traitFactorForRarity(p), 0),
    0,
    2,
  );
  const traitPremium = round(floorValue * traitFactorSum);

  const totalEstimate = round(floorValue + rarityPremium + traitPremium);

  return {
    floorValue,
    rarityPremium,
    traitPremium,
    historicalSalesPremium: null,
    demandPremium: null,
    rewardValue: null,
    totalEstimate,
    totalEstimateUsd: round(totalEstimate * xchUsdRate),
    estimatedAt: new Date().toISOString(),
  };
}
