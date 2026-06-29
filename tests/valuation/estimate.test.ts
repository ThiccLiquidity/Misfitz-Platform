import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateFairValue,
  rarityFactorForPercentile,
  traitFactorForRarity,
} from "../../src/lib/valuation/estimate";

test("rarity factor decreases as items get more common", () => {
  assert.equal(rarityFactorForPercentile(0.5), 4.0);
  assert.equal(rarityFactorForPercentile(5), 2.0);
  assert.equal(rarityFactorForPercentile(10), 1.0);
  assert.equal(rarityFactorForPercentile(25), 0.4);
  assert.equal(rarityFactorForPercentile(50), 0.15);
  assert.equal(rarityFactorForPercentile(90), 0.05);
});

test("trait factor rewards rarer traits", () => {
  assert.ok(traitFactorForRarity(1) > traitFactorForRarity(5));
  assert.ok(traitFactorForRarity(5) > traitFactorForRarity(20));
  assert.equal(traitFactorForRarity(60), 0);
});

test("no floor => no estimate (never a fake 0)", () => {
  assert.equal(
    estimateFairValue({ floorXch: 0, rarityRank: 1, totalSupply: 100, traitRarityPercents: [], xchUsdRate: 10 }),
    null,
  );
});

test("estimate composes floor + rarity + trait premiums and USD", () => {
  const fv = estimateFairValue({
    floorXch: 1.0,
    rarityRank: 72,
    totalSupply: 250, // 28.8th percentile -> 0.15x floor
    traitRarityPercents: [11.2, 16.8, 60], // 0.03 + 0.03 + 0 = 0.06x floor
    xchUsdRate: 10,
  });
  assert.ok(fv);
  assert.equal(fv.floorValue, 1.0);
  assert.equal(fv.rarityPremium, 0.15);
  assert.equal(fv.traitPremium, 0.06);
  assert.equal(fv.totalEstimate, 1.21);
  assert.equal(fv.totalEstimateUsd, 12.1);
  assert.equal(fv.historicalSalesPremium, null);
});

test("rarer NFT estimates higher than a common one at same floor", () => {
  const rare = estimateFairValue({ floorXch: 2, rarityRank: 1, totalSupply: 1000, traitRarityPercents: [], xchUsdRate: 10 })!;
  const common = estimateFairValue({ floorXch: 2, rarityRank: 900, totalSupply: 1000, traitRarityPercents: [], xchUsdRate: 10 })!;
  assert.ok(rare.totalEstimate > common.totalEstimate);
});
