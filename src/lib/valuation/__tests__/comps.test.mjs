import test from "node:test";
import assert from "node:assert/strict";
import { buildCompsModel } from "../comps.ts";

// Synthetic collection: rarer rank => higher price, plus an "alien" trait that doubles value.
function makeSales() {
  const sales = [];
  for (let rank = 50; rank <= 9000; rank += 50) {
    const base = 50 / rank * 40 + 3; // rarer (low rank) pricier, common ~3
    const alien = rank < 200;        // a few ultra-rares are aliens
    const traits = [{ k: "Body", v: alien ? "Alien" : "Male" }];
    sales.push({ rank, price: alien ? base * 2 : base, ageDays: 10, traits });
  }
  return sales;
}

test("returns null on empty", () => {
  assert.equal(buildCompsModel([]), null);
});

test("rank curve: rarer ranks value higher than common", () => {
  const m = buildCompsModel(makeSales());
  assert.ok(m);
  const rare = m.rankCurve(100);
  const common = m.rankCurve(8000);
  assert.ok(rare > common, `expected rare(${rare}) > common(${common})`);
});

test("alien trait carries a real premium multiplier", () => {
  const m = buildCompsModel(makeSales());
  const alien = m.traitMult("Body", "Alien");
  const male = m.traitMult("Body", "Male");
  assert.ok(alien.mult > 1.3, `alien mult ${alien.mult} should be >1.3`);
  assert.ok(Math.abs(male.mult - 1) < 0.25, `male mult ${male.mult} ~1`);
});

test("valueOf blends rank + trait and reports confidence", () => {
  const m = buildCompsModel(makeSales());
  const v = m.valueOf(120, [{ k: "Body", v: "Alien" }]);
  assert.ok(v.value > 0);
  assert.ok(v.confidence > 0 && v.confidence <= 1);
  assert.match(v.basis, /Alien/);
});

test("case-insensitive trait lookup", () => {
  const m = buildCompsModel(makeSales());
  assert.equal(m.traitMult("body", "alien").n, m.traitMult("Body", "Alien").n);
});

test("recency: a fresh high sale outweighs a stale low one at same rank", () => {
  const sales = [
    { rank: 500, price: 2, ageDays: 700 },
    { rank: 500, price: 20, ageDays: 1 },
    { rank: 520, price: 19, ageDays: 1 },
    { rank: 480, price: 21, ageDays: 1 },
  ];
  const m = buildCompsModel(sales, { k: 4 });
  assert.ok(m.rankCurve(500) >= 19, `expected fresh ~20, got ${m.rankCurve(500)}`);
});
