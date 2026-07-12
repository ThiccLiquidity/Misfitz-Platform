import { test } from "node:test";
import assert from "node:assert/strict";
import { dripSchedule, cumulativeDistributed } from "@/lib/rewards/drip";

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

test("5%/mo distributes ~46% yr1, ~71% yr2, ~84% yr3", () => {
  assert.ok(near(cumulativeDistributed(500, 12), 0.4596));
  assert.ok(near(cumulativeDistributed(500, 24), 0.7080));
  assert.ok(near(cumulativeDistributed(500, 36), 0.8422));
});

test("10%/mo distributes ~72% yr1, ~92% yr2", () => {
  assert.ok(near(cumulativeDistributed(1000, 12), 0.7176));
  assert.ok(near(cumulativeDistributed(1000, 24), 0.9202));
});

test("schedule cumulative matches closed form and never exceeds 1", () => {
  const sched = dripSchedule(500, 36);
  assert.ok(near(sched[11].cumulativeFraction, cumulativeDistributed(500, 12)));
  assert.ok(sched[sched.length - 1].cumulativeFraction < 1);
  assert.ok(sched[sched.length - 1].remainingFraction > 0);
});
