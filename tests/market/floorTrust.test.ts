import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedFloorFrom, SALES_CAP_MULT } from "../../src/lib/market/floorTrust";

test("no sales + a lone troll ask -> UNPRICED (indicative ask shown, no value)", () => {
  const r = trustedFloorFrom(null, [9_999_999]); // the 'Not' case: 1 troll listing, zero sales
  assert.equal(r.valueFloor, null);
  assert.equal(r.displayAsk, 9_999_999);
  assert.equal(r.trust, "indicative");
});

test("no sales + no ask -> nothing", () => {
  const r = trustedFloorFrom(null, []);
  assert.deepEqual([r.valueFloor, r.displayAsk, r.trust], [null, null, "none"]);
});

test("HonKers: cheapest real ask is the floor, NOT the old sales-cap (100, not 20)", () => {
  // Real Dexie data: recent sales ~5 XCH, but active asks are 100, 369, then a wall of 420s.
  const r = trustedFloorFrom(5, [100, 369, 420, 420, 420, 420, 420, 420, 420]);
  assert.equal(r.valueFloor, 100);   // the cheapest listing you can actually buy at
  assert.equal(r.capped, false);
  assert.equal(r.trust, "sales-backed");
});

test("a troll HIGH ask among real listings is ignored (cheapest wins)", () => {
  const r = trustedFloorFrom(100, [110, 115, 120, 130, 9_999_999]);
  assert.equal(r.valueFloor, 110);
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
