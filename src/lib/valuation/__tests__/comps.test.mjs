import test from "node:test";
import assert from "node:assert/strict";
import { buildCompsModel } from "../comps.ts";

const SUPPLY = 9985;

// Synthetic collection: price rises with rarity (low rank). A "Gold" accessory carries a +50% premium
// that is INDEPENDENT of rank (spread across the whole collection) — the kind of premium the model
// should reward. "Body=Male" is on everything (neutral).
function makeSales() {
  const sales = [];
  let i = 0;
  for (let rank = 50; rank <= 9000; rank += 25) {
    const base = (50 / rank) * 40 + 3;         // rarer => pricier
    const gold = i % 5 === 0;                  // ~20% carry Gold, across ALL ranks
    const price = gold ? base * 1.5 : base;    // Gold = +50% regardless of rank
    sales.push({ rank, price, ageDays: 10, traits: [
      { k: "Accessory", v: gold ? "Gold" : "None" },
      { k: "Body", v: "Male" },
    ] });
    i++;
  }
  return sales;
}

test("returns null on empty", () => {
  assert.equal(buildCompsModel([], SUPPLY), null);
});

test("rank curve: rarer ranks value higher than common", () => {
  const m = buildCompsModel(makeSales(), SUPPLY);
  assert.ok(m.rankCurve(100) > m.rankCurve(8000));
});

test("rank-independent trait premium is captured, with no rarity penalty", () => {
  const m = buildCompsModel(makeSales(), SUPPLY);
  const gold = m.traitMult("Accessory", "Gold");
  assert.ok(gold.mult > 1.3, `gold mult ${gold.mult} should be >1.3`);
  assert.equal(gold.penalty, 1.0); // spread across all ranks -> not rarity-correlated
  assert.ok(gold.reliability > 0.8, `gold reliability ${gold.reliability}`);
  const none = m.traitMult("Accessory", "None");
  assert.ok(Math.abs(none.mult - 1) < 0.2, `none mult ${none.mult} ~1`);
});

test("valueOf: gold boosts value, clamped to <=3x, basis names the trait", () => {
  const m = buildCompsModel(makeSales(), SUPPLY);
  const withGold = m.valueOf(500, [{ k: "Accessory", v: "Gold" }, { k: "Body", v: "Male" }]);
  const plain = m.valueOf(500, [{ k: "Body", v: "Male" }]);
  assert.ok(withGold.value > plain.value, "gold should raise the value");
  assert.ok(withGold.value <= plain.value * 3 + 1e-6, "trait factor clamped at 3x");
  assert.ok(withGold.confidence > 0 && withGold.confidence <= 1);
  assert.match(withGold.basis, /Gold/);
});

test("rank-correlated trait gets the 0.5 penalty (no double-counting rarity)", () => {
  const sales = [];
  for (let rank = 1; rank <= 100; rank++) sales.push({ rank, price: 50, ageDays: 5, traits: [{ k: "Body", v: "Alien" }] });
  for (let rank = 200; rank <= 9000; rank += 50) sales.push({ rank, price: 5, ageDays: 5, traits: [{ k: "Body", v: "Common" }] });
  const m = buildCompsModel(sales, SUPPLY);
  assert.equal(m.traitMult("Body", "Alien").penalty, 0.5); // only on the rarest 1% -> penalised
});

test("trait factor never exceeds the [0.6, 3] clamp", () => {
  // A wildly overpriced trait shouldn't blow up the value beyond 3x the rank curve.
  const sales = [];
  for (let rank = 100; rank <= 9000; rank += 30) {
    const hot = rank % 3 === 0;
    sales.push({ rank, price: hot ? 100 : 5, ageDays: 5, traits: [{ k: "X", v: hot ? "Hot" : "Cold" }] });
  }
  const m = buildCompsModel(sales, SUPPLY);
  const v = m.valueOf(500, [{ k: "X", v: "Hot" }]);
  const base = m.rankCurve(500);
  assert.ok(v.value <= base * 3 + 1e-6, `value ${v.value} should be <= 3x base ${base}`);
});

test("case-insensitive trait lookup", () => {
  const m = buildCompsModel(makeSales(), SUPPLY);
  assert.equal(m.traitMult("accessory", "gold").n, m.traitMult("Accessory", "Gold").n);
});

test("recency: a fresh high sale outweighs a stale low one at the same rank", () => {
  const sales = [
    { rank: 500, price: 2, ageDays: 700 },
    { rank: 500, price: 20, ageDays: 1 },
    { rank: 520, price: 19, ageDays: 1 },
    { rank: 480, price: 21, ageDays: 1 },
  ];
  const m = buildCompsModel(sales, 1000);
  assert.ok(m.rankCurve(500) >= 19, `expected fresh ~20, got ${m.rankCurve(500)}`);
});
