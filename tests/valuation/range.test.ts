import { test } from "node:test";
import assert from "node:assert/strict";
import { valueRange, confidenceFor } from "../../src/lib/valuation/range";

test("confidence rises with market data", () => {
  assert.equal(confidenceFor({ activeListings: 8, recentSales: 6 }), "high");
  assert.equal(confidenceFor({ activeListings: 4, recentSales: 0 }), "medium");
  assert.equal(confidenceFor({ activeListings: 0, recentSales: 3 }), "medium");
  assert.equal(confidenceFor({ activeListings: 1, recentSales: 0 }), "low");
});

test("range is capped and tightest at high confidence", () => {
  const high = valueRange(10, { activeListings: 8, recentSales: 6 });
  assert.equal(high.confidence, "high");
  assert.equal(high.low, 9.2);
  assert.equal(high.high, 10.8);

  const low = valueRange(10, { activeListings: 0, recentSales: 0 });
  assert.equal(low.confidence, "low");
  assert.equal(low.low, 7.2);
  assert.equal(low.high, 12.8);
  // even worst-case the band is bounded (±28%), never absurd
  assert.ok((low.high - low.low) / low.point <= 0.56 + 1e-9);
});
