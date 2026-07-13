import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MISFITZ_TOKEN, UNITS_PER_TOKEN, reconciles, dripForMonth, cumulativeDrip, circulating, tokenStr,
} from "../../src/lib/rewards/token";

const T = (n: number) => BigInt(n) * UNITS_PER_TOKEN;

test("supply reconciles: buckets sum to the 1B total; splits are 10/67/5/15/3", () => {
  assert.equal(reconciles(MISFITZ_TOKEN), true);
  assert.equal(MISFITZ_TOKEN.totalSupplyUnits, T(1_000_000_000));
  assert.equal(MISFITZ_TOKEN.airdropUnits, T(100_000_000));   // 10%
  assert.equal(MISFITZ_TOKEN.dripPoolUnits, T(670_000_000));  // 67% holder drip
  assert.equal(MISFITZ_TOKEN.lpSeedUnits, T(50_000_000));     // 5% seed the pool
  assert.equal(MISFITZ_TOKEN.lpRewardUnits, T(150_000_000));  // 15% LP-holder airdrop reserve
  assert.equal(MISFITZ_TOKEN.teamUnits, T(30_000_000));       // 3% -> operator whale
  assert.equal(
    MISFITZ_TOKEN.airdropUnits + MISFITZ_TOKEN.dripPoolUnits + MISFITZ_TOKEN.lpSeedUnits + MISFITZ_TOKEN.lpRewardUnits + MISFITZ_TOKEN.teamUnits,
    MISFITZ_TOKEN.totalSupplyUnits,
  );
});

test("dripForMonth: month 1 = 5% of the pool; geometric decline; floored bigint", () => {
  const pool = MISFITZ_TOKEN.dripPoolUnits;
  const m1 = dripForMonth(pool, 1, 500);
  assert.equal(m1.drip, T(33_500_000));           // 5% of 670M = 33.5M
  assert.equal(m1.remainingAfter, T(636_500_000));
  const m2 = dripForMonth(pool, 2, 500);
  assert.ok(m2.drip < m1.drip, "each month drips less than the last (geometric)");
  assert.equal(dripForMonth(pool, 0, 500).drip, BigInt(0)); // month 0 -> nothing
});

test("cumulativeDrip: ~46% out after year 1; monotonic; never exceeds the pool", () => {
  const pool = MISFITZ_TOKEN.dripPoolUnits;
  const y1 = cumulativeDrip(pool, 12, 500);
  const ratio = (y1 * BigInt(10000)) / pool; // basis points of the pool distributed
  assert.ok(ratio >= BigInt(4590) && ratio <= BigInt(4600), `~46% expected, got ${ratio} bps`);
  assert.ok(cumulativeDrip(pool, 24, 500) > y1, "monotonic");
  assert.ok(cumulativeDrip(pool, 999, 500) <= pool, "never exceeds the pool");
});

test("circulating: launch = airdrop+team+lpSeed (LP-reward reserve stays locked); burns remove; never negative", () => {
  const c0 = circulating(MISFITZ_TOKEN, 0, BigInt(0));
  assert.equal(c0.releasedUnits, T(180_000_000)); // 100M airdrop + 30M team + 50M LP seed
  assert.equal(c0.circulatingUnits, T(180_000_000));
  assert.equal(c0.lpRewardReserveUnits, T(150_000_000)); // 15% reserve locked until the LP program releases it
  const c1 = circulating(MISFITZ_TOKEN, 1, T(5_000_000)); // 1 month dripped (33.5M), 5M burned
  assert.equal(c1.circulatingUnits, c0.circulatingUnits + T(33_500_000) - T(5_000_000));
  // burning MORE than released is impossible -> throws (an operator units/tokens typo), not a silent clamp.
  assert.throws(() => circulating(MISFITZ_TOKEN, 0, T(999_000_000)), /exceeds released/);
  assert.throws(() => circulating(MISFITZ_TOKEN, 0, BigInt(-1)), /negative/);
});

test("tokenStr formats base units to token amounts", () => {
  assert.equal(tokenStr(T(1_000_000)), "1,000,000");
  assert.equal(tokenStr(BigInt(1500)), "1.5");   // 1500 base units = 1.5 tokens
  assert.equal(tokenStr(BigInt(1)), "0.001");    // smallest unit
});
