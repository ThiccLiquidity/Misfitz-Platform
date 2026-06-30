import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateFairValue, rarityFactorForPercentile, robustFloor } from "../../src/lib/valuation/estimate";

test("rarity factor decreases as items get more common", () => {
  assert.equal(rarityFactorForPercentile(0.05), 14); // mythic — grail
  assert.equal(rarityFactorForPercentile(0.5), 7);   // legendary
  assert.equal(rarityFactorForPercentile(2), 2.0);   // epic
  assert.equal(rarityFactorForPercentile(10), 0.8);  // rare
  assert.equal(rarityFactorForPercentile(20), 0.2);  // uncommon keeps a small premium
  assert.equal(rarityFactorForPercentile(50), 0);    // common sits at floor
  assert.equal(rarityFactorForPercentile(90), 0);
});

test("robust floor is the median of the cheapest few, ignoring a troll listing", () => {
  // cheapest 5 of these are [1.0,1.1,1.2,1.3,1.4] -> median 1.2; the 0.01 troll is included but
  // the median shrugs it off vs using the raw min.
  assert.equal(robustFloor([2, 1.3, 1.1, 1.4, 1.2, 1.0, 9]), 1.2);
  assert.equal(robustFloor([]), null);
  assert.equal(robustFloor([3]), 3);
});

test("no floor => no estimate (never a fake 0)", () => {
  assert.equal(
    estimateFairValue({ floorXch: 0, rarityRank: 1, totalSupply: 100, xchUsdRate: 10 }),
    null,
  );
});

test("estimate = floor + rarity + desirability; no standalone trait double-count", () => {
  const fv = estimateFairValue({
    floorXch: 1.0,
    rarityRank: 72,
    totalSupply: 250, // 28.8th percentile -> 0.15x floor
    desirabilityWeight: 0.03, // e.g. a palindrome
    xchUsdRate: 10,
  })!;
  assert.equal(fv.floorValue, 1.0);
  assert.equal(fv.rarityPremium, 0.15);
  assert.equal(fv.desirabilityPremium, 0.03);
  assert.equal(fv.traitPremium, 0); // reserved for dynamic trait demand
  assert.equal(fv.totalEstimate, 1.18);
  assert.equal(fv.totalEstimateUsd, 11.8);
});

test("a grail number meaningfully bumps value; rarer outranks common at same floor", () => {
  const grail = estimateFairValue({ floorXch: 2, rarityRank: 500, totalSupply: 1000, desirabilityWeight: 0.4, xchUsdRate: 10 })!;
  const plain = estimateFairValue({ floorXch: 2, rarityRank: 500, totalSupply: 1000, desirabilityWeight: 0, xchUsdRate: 10 })!;
  assert.ok(grail.totalEstimate > plain.totalEstimate);
  const rare = estimateFairValue({ floorXch: 2, rarityRank: 1, totalSupply: 1000, xchUsdRate: 10 })!;
  const common = estimateFairValue({ floorXch: 2, rarityRank: 900, totalSupply: 1000, xchUsdRate: 10 })!;
  assert.ok(rare.totalEstimate > common.totalEstimate);
});
