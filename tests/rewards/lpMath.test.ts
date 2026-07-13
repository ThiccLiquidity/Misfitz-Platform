import { test } from "node:test";
import assert from "node:assert/strict";
import { tenureMultiplier, twab, nextTenure, lpWeight, computeLpEpoch, rollCohorts, rollLpEpoch, LP_MULT_CAP, type LpCohort } from "../../src/lib/rewards/lpMath";

const T = (tokens: number) => BigInt(tokens) * BigInt(1000); // LP CAT 3dp

test("tenureMultiplier: hits the locked anchors 1/1.5/2.5/4/5; capped; 0 when not holding", () => {
  assert.equal(tenureMultiplier(0), 0);
  assert.equal(tenureMultiplier(1), 1);
  assert.ok(Math.abs(tenureMultiplier(3) - 1.5) < 1e-9);
  assert.ok(Math.abs(tenureMultiplier(6) - 2.5) < 1e-9);
  assert.ok(Math.abs(tenureMultiplier(12) - 4) < 1e-9);
  assert.ok(Math.abs(tenureMultiplier(18) - 5) < 1e-9);
  assert.equal(tenureMultiplier(36), LP_MULT_CAP);
});

test("twab / nextTenure / lpWeight basics", () => {
  assert.equal(twab([T(10), T(20), T(30)]), T(20));
  assert.equal(nextTenure(5, true), 6);
  assert.equal(nextTenure(5, false), 0);
  assert.ok(Math.abs(lpWeight(T(100), 12) - 400) < 1e-6);
});

test("computeLpEpoch: solvent split; longer tenure earns more", () => {
  const r = computeLpEpoch([
    { wallet: "xch1alice", twabUnits: T(100), monthsHeld: 12 },
    { wallet: "xch1bob", twabUnits: T(100), monthsHeld: 1 },
  ], T(50_000));
  assert.equal(r.solvent, true);
  assert.equal(r.distributedUnits, T(50_000));
  assert.ok(r.wallets.find((w) => w.wallet === "xch1alice")!.tokenUnits > r.wallets.find((w) => w.wallet === "xch1bob")!.tokenUnits * BigInt(3));
});

// ── rollCohorts: per-unit aging ────────────────────────────────────────────────

test("rollCohorts: fresh capital gets its own month-1 cohort; aging is per cohort", () => {
  let c: LpCohort[] = [];
  c = rollCohorts(c, T(100)); // month 1: 100 fresh
  assert.deepEqual(c, [{ units: T(100), months: 1 }]);
  c = rollCohorts(c, T(100)); // month 2: same balance ages
  assert.deepEqual(c, [{ units: T(100), months: 2 }]);
  c = rollCohorts(c, T(300)); // month 3: +200 fresh -> two cohorts
  assert.equal(c.length, 2);
  assert.deepEqual(c.find((x) => x.months === 3), { units: T(100), months: 3 });
  assert.deepEqual(c.find((x) => x.months === 1), { units: T(200), months: 1 });
});

test("rollCohorts: a reduction removes NEWEST units first (aged units keep tenure)", () => {
  let c: LpCohort[] = [{ units: T(100), months: 10 }, { units: T(100), months: 2 }];
  c = rollCohorts(c, T(120)); // age -> 11 & 3; total 200 -> trim 80 off the newest (the 3mo cohort)
  assert.deepEqual(c.find((x) => x.months === 11), { units: T(100), months: 11 });
  assert.deepEqual(c.find((x) => x.months === 3), { units: T(20), months: 3 });
});

test("rollCohorts: full exit drops everything; matured cohorts merge at the 18mo cap", () => {
  assert.deepEqual(rollCohorts([{ units: T(5), months: 4 }], BigInt(0)), []);
  const c = rollCohorts([{ units: T(10), months: 18 }, { units: T(5), months: 20 }], T(15));
  const capped = c.filter((x) => x.months >= 18);
  assert.equal(capped.length, 1); // merged
  assert.equal(capped[0].units, T(15));
});

// ── rollLpEpoch: the exploit B4 was meant to close ──────────────────────────────

test("rollLpEpoch: dust-then-deploy stays at ~1x THIS month AND next (cohort clock, not wallet clock)", () => {
  // Whale parked 1 token for 18 months -> a single matured cohort {1, 18}. Now deploys 1000.
  const prev = { xch1whale: [{ units: T(1), months: 18 }] as LpCohort[], xch1loyal: [{ units: T(1000), months: 18 }] as LpCohort[] };
  // Month 19
  let obs = { runs: 1, sums: { xch1whale: T(1000), xch1loyal: T(1000) } };
  let r = rollLpEpoch(obs, prev, T(100_000), { advanceTenure: true });
  let whale = r.result.wallets.find((w) => w.wallet === "xch1whale")!;
  let loyal = r.result.wallets.find((w) => w.wallet === "xch1loyal")!;
  assert.ok(loyal.tokenUnits > whale.tokenUnits * BigInt(3), "month 19: loyal >> whale");
  // Month 20: feed month-19's persisted cohorts back in. The whale's 1000 is now a 2mo cohort, NOT 5x.
  obs = { runs: 1, sums: { xch1whale: T(1000), xch1loyal: T(1000) } };
  r = rollLpEpoch(obs, r.nextState, T(100_000), { advanceTenure: true });
  whale = r.result.wallets.find((w) => w.wallet === "xch1whale")!;
  loyal = r.result.wallets.find((w) => w.wallet === "xch1loyal")!;
  assert.ok(whale.multiplier < 1.4, `month 20 whale still low (${whale.multiplier})`);
  assert.ok(loyal.tokenUnits > whale.tokenUnits * BigInt(3), "month 20: loyal STILL >> whale (exploit closed)");
});

test("rollLpEpoch: solvent; excluded dropped; absent resets; outage preserves; mtd untouched", () => {
  const obs = { runs: 10, sums: { xch1op: T(10_000), xch1a: T(1000) } };
  const r = rollLpEpoch(obs, {}, T(5000), { advanceTenure: true, excluded: new Set(["xch1op"]) });
  assert.equal(r.result.solvent, true);
  assert.equal(r.result.distributedUnits, T(5000));
  assert.equal(r.result.wallets.some((w) => w.wallet === "xch1op"), false);
  assert.equal("xch1op" in r.nextState, false);
  // absent wallet resets
  const r2 = rollLpEpoch({ runs: 5, sums: {} }, { xch1ghost: [{ units: T(50), months: 9 }] }, T(1000), { advanceTenure: true });
  assert.deepEqual(r2.nextState, { xch1ghost: [{ units: T(50), months: 9 }] }); // outage guard: empty obs preserves
  const r3 = rollLpEpoch({ runs: 5, sums: { xch1x: T(0) } }, { xch1ghost: [{ units: T(50), months: 9 }] }, T(1000), { advanceTenure: true });
  assert.equal("xch1ghost" in r3.nextState, false); // real epoch, ghost absent -> reset
  // mtd preview doesn't mutate
  const prev = { xch1a: [{ units: T(10), months: 3 }] as LpCohort[] };
  const mtd = rollLpEpoch({ runs: 5, sums: { xch1a: T(50) } }, prev, T(100), { advanceTenure: false });
  assert.equal(mtd.nextState, prev);
});
