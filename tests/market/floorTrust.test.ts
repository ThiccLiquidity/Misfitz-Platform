import { test } from "node:test";
import assert from "node:assert/strict";
import { trustedFloorFrom, SALES_CAP_MULT } from "../../src/lib/market/floorTrust";

test("no sales + a troll ask -> UNPRICED (indicative ask shown, no value)", () => {
  const r = trustedFloorFrom(null, 9_999_999, null); // the 'Not' case: 1 troll listing, zero sales
  assert.equal(r.valueFloor, null);      // contributes 0 to the total
  assert.equal(r.displayAsk, 9_999_999); // still shown, labeled unverified
  assert.equal(r.trust, "indicative");
  assert.equal(r.capped, false);
});

test("no sales + no ask -> nothing", () => {
  const r = trustedFloorFrom(null, null, null);
  assert.deepEqual([r.valueFloor, r.displayAsk, r.trust], [null, null, "none"]);
});

test("sales + a troll ask -> value CAPPED at SALES_CAP_MULT x the sales anchor", () => {
  const r = trustedFloorFrom(10, 9_999_999, null); // recent sales ~10 XCH, someone lists at 9.9M
  assert.equal(r.valueFloor, SALES_CAP_MULT * 10); // 40, not 9.9M
  assert.equal(r.displayAsk, 9_999_999);
  assert.equal(r.trust, "sales-backed");
  assert.equal(r.capped, true);
});

test("sales + a sane ask within the cap -> passthrough (legit collections untouched)", () => {
  const r = trustedFloorFrom(100, 120, null); // real 100 XCH sales, 120 ask (< 4x100)
  assert.equal(r.valueFloor, 120);
  assert.equal(r.capped, false);
  assert.equal(r.trust, "sales-backed");
});

test("sales but no active ask -> value against the sales anchor", () => {
  const r = trustedFloorFrom(50, null, null);
  assert.equal(r.valueFloor, 50);
  assert.equal(r.trust, "sales-backed");
});

test("no dexie ask but a MintGarden floor, with sales -> uses mgFloor (capped)", () => {
  assert.equal(trustedFloorFrom(10, null, 30).valueFloor, 30);        // within 4x
  assert.equal(trustedFloorFrom(10, null, 9_999_999).valueFloor, 40); // capped
});
