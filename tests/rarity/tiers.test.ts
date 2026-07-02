import { test } from "node:test";
import assert from "node:assert/strict";
import { tierIdForPercentile, getRarityTier, resolveTierThresholds, formatPercentile, DEFAULT_RARITY_TIERS } from "../../src/lib/rarity/tiers";

test("tierIdForPercentile buckets by cumulative band", () => {
  assert.equal(tierIdForPercentile(0.05), "mythic");
  assert.equal(tierIdForPercentile(0.1), "mythic");
  assert.equal(tierIdForPercentile(0.4), "legendary");
  assert.equal(tierIdForPercentile(2), "epic");
  assert.equal(tierIdForPercentile(8), "rare");
  assert.equal(tierIdForPercentile(25), "uncommon");
  assert.equal(tierIdForPercentile(80), "common");
  assert.equal(tierIdForPercentile(100), "common");
});

test("getRarityTier: unranked when rank/supply missing", () => {
  assert.equal(getRarityTier(null, 1000).percentileLabel, "Unranked");
  assert.equal(getRarityTier(null, 1000).percentile, null);
  assert.equal(getRarityTier(5, 0).percentileLabel, "Unranked");
});

test("getRarityTier: ranked maps rank/supply to a tier", () => {
  const rare = getRarityTier(1, 1000); // 0.1% -> mythic
  assert.equal(rare.id, "mythic");
  assert.equal(rare.rank, 1);
  assert.equal(getRarityTier(900, 1000).id, "common"); // 90% -> common
});

test("resolveTierThresholds merges overrides over defaults", () => {
  const r = resolveTierThresholds({ mythic: 0.05 });
  assert.equal(r.mythic, 0.05);
  assert.equal(r.legendary, DEFAULT_RARITY_TIERS.legendary);
  assert.equal(resolveTierThresholds(), DEFAULT_RARITY_TIERS);
});

test("formatPercentile decimals scale with magnitude", () => {
  assert.equal(formatPercentile(0.67), "Top 0.67%");
  assert.equal(formatPercentile(5), "Top 5.0%");
  assert.equal(formatPercentile(25), "Top 25%");
});
