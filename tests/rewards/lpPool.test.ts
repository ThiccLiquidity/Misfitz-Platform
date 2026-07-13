import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTibetPair, lpPositionBreakdown } from "../../src/lib/rewards/lpPool";

const XCH = (n: number) => BigInt(n) * BigInt(1_000_000_000_000); // 1 XCH = 1e12 mojos
const TOK = (n: number) => BigInt(n) * BigInt(1000);              // CAT 3dp

const sample = [
  { asset_id: "tokenTAIL", liquidity_asset_id: "lpTAIL", xch_reserve: Number(XCH(100)), token_reserve: Number(TOK(1_000_000)), liquidity: Number(TOK(50_000)) },
  { asset_id: "otherTAIL", liquidity_asset_id: "x", xch_reserve: 1, token_reserve: 1, liquidity: 1 },
];

test("parseTibetPair: finds the pair by TAIL; tolerant of array or single; null when absent/malformed", () => {
  const p = parseTibetPair(sample, "tokenTAIL");
  assert.ok(p);
  assert.equal(p.liquidityAssetId, "lpTAIL");
  assert.equal(p.xchReserveMojos, XCH(100));
  assert.equal(p.tokenReserveUnits, TOK(1_000_000));
  assert.equal(p.lpSupplyUnits, TOK(50_000));
  // single-object form
  assert.ok(parseTibetPair(sample[0], "tokenTAIL"));
  // absent / malformed
  assert.equal(parseTibetPair(sample, "missing"), null);
  assert.equal(parseTibetPair([{ asset_id: "tokenTAIL", liquidity_asset_id: "lpTAIL", xch_reserve: "oops", token_reserve: 1, liquidity: 1 }], "tokenTAIL"), null);
  assert.equal(parseTibetPair(null, "tokenTAIL"), null);
});

test("lpPositionBreakdown: pro-rata slice of reserves; 10% of pool -> 10% of each reserve", () => {
  const p = parseTibetPair(sample, "tokenTAIL")!;
  const pos = lpPositionBreakdown(TOK(5_000), p); // 5,000 of 50,000 LP supply = 10%
  assert.equal(pos.sharePpm, 100_000); // 10% in ppm
  assert.equal(pos.xchMojos, XCH(10));
  assert.equal(pos.tokenUnits, TOK(100_000));
  // zero / empty pool -> zeros
  assert.deepEqual(lpPositionBreakdown(BigInt(0), p), { sharePpm: 0, xchMojos: BigInt(0), tokenUnits: BigInt(0) });
});
