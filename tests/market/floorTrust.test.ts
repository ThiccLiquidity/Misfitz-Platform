import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedFloorFrom, SALES_CAP_MULT } from "../../src/lib/market/floorTrust";

test("no sales + a lone troll ask -> UNPRICED (indicative ask shown, no value)", () => {
  const r = trustedFloorFrom(null, [9_999_999]); // the 'Not' case: 1 troll listing, zero sales
  assert.equal(r.valueFloor, null);      // contributes 0 to the total
  assert.equal(r.displayAsk, 9_999_999); // still shown, labeled unverified
  assert.equal(r.trust, "indicative");
});

test("no sales + no ask -> nothing", () => {
  const r = trustedFloorFrom(null, []);
  assert.deepEqual([r.valueFloor, r.displayAsk, r.trust], [null, null, "none"]);
});

test("legit run-up: many consistent asks well above old sales -> robust floor shown (NOT capped)", () => {
  // Honkers: recent sales ~5 XCH, but the market ran up and everyone lists ~400.
  const r = trustedFloorFrom(5, [400, 405, 410, 420, 430, 450]);
  assert.equal(r.valueFloor, 410);   // median of the cheapest 5 (400,405,410,420,430) = 410 — the real floor
  assert.equal(r.capped, false);
  assert.equal(r.trust, "sales-backed");
});

test("robust median ignores a single troll HIGH ask among real listings", () => {
  const r = trustedFloorFrom(100, [110, 115, 120, 130, 9_999_999]); // one troll among 4 real asks
  assert.equal(r.valueFloor, 120); // median of cheapest 5 — troll excluded
});

test("THIN collection: a lone ask far above sales IS sanity-capped (troll defense)", () => {
  const r = trustedFloorFrom(10, [9_999_999]); // sales ~10, single troll ask, no listing consensus
  assert.equal(r.valueFloor, SALES_CAP_MULT * 10); // 40, not 9.9M
  assert.equal(r.capped, true);
});

test("sales but no active asks -> value against the sales anchor", () => {
  const r = trustedFloorFrom(50, []);
  assert.equal(r.valueFloor, 50);
  assert.equal(r.trust, "sales-backed");
});
