import test from "node:test";
import assert from "node:assert/strict";
import { recordSalesActivity, activityLevel, adaptiveTtl } from "../src/lib/market/activity.ts";

const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const base = 5 * 60_000;

test("unknown collection is quiet, TTL = base", () => {
  assert.equal(activityLevel("col1quiet"), 0);
  assert.equal(adaptiveTtl("col1quiet", base), base);
});

test("a burst of recent sales reads as hot and shortens the TTL (but not below the floor)", () => {
  const sales = Array.from({ length: 10 }, (_, i) => ({ date: iso(i * 5) })); // 10 sales in last ~50 min
  recordSalesActivity("col1hot", sales);
  assert.equal(activityLevel("col1hot"), 2, "10 recent sales => hot");
  const ttl = adaptiveTtl("col1hot", base);
  assert.ok(ttl < base, "hot TTL is shorter than base");
  assert.ok(ttl >= 45_000, "never below the 45s hard floor");
});

test("a few sales read as warm (~half TTL)", () => {
  recordSalesActivity("col1warm", [{ date: iso(10) }, { date: iso(30) }, { date: iso(60) }]);
  assert.equal(activityLevel("col1warm"), 1);
  assert.equal(adaptiveTtl("col1warm", base), base / 2);
});

test("old sales (outside the window) do NOT count as busy", () => {
  const old = Array.from({ length: 10 }, () => ({ date: iso(60 * 24) })); // all a day old
  recordSalesActivity("col1stale", old);
  assert.equal(activityLevel("col1stale"), 0, "day-old sales => quiet");
});
