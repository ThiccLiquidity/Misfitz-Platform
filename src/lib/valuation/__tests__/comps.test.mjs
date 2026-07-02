import test from "node:test";
import assert from "node:assert/strict";
import { buildCompsModel } from "../comps.ts";

test("returns null on empty", () => {
  assert.equal(buildCompsModel([], 1000), null);
});

test("rarer ranks value higher (smooth baseline + sales)", () => {
  const sales = [];
  for (let r = 100; r <= 900; r += 50) sales.push({ rank: r, price: (50 / r) * 40 + 5, ageDays: 10 });
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: (p) => (p <= 10 ? 3 : p <= 50 ? 0.5 : 0) });
  assert.ok(m.curveValue(100) > m.curveValue(800));
});

test("single sale -> one smooth, monotonic parabola (no waves), never below floor", () => {
  // With a global parabola fit, a lone sale sets the overall level while the RARITY SHAPE keeps the
  // rare end above the common end. (The old local model left distant commons at floor; the parabola
  // averages a level instead — sparse data is regularized toward the baseline but still lifts.)
  const sales = [{ rank: 50, price: 80, ageDays: 5 }];
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: (p) => (p >= 50 ? 0 : 1) });
  assert.ok(m.curveValue(50) > m.curveValue(900), "rarer must value >= commoner");
  assert.ok(m.curveValue(900) >= 5, "never below floor");
  assert.ok(m.curveValue(50) >= 40, `rare end reflects the sale, got ${m.curveValue(50)}`);
});

test("trait demand: a trait selling MORE OFTEN than its prevalence runs hot (>1)", () => {
  const sales = [];
  for (let i = 0; i < 10; i++) sales.push({ rank: 100 + i * 10, price: 20, ageDays: 5, traits: [{ k: "Accessory", v: "Gold" }] });
  for (let i = 0; i < 10; i++) sales.push({ rank: 500 + i * 10, price: 18, ageDays: 5, traits: [{ k: "Accessory", v: "None" }] });
  const freq = { accessory: { gold: 50, none: 950 } }; // Gold is only 5% of the collection
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  const gold = m.traitDemand([{ k: "Accessory", v: "Gold" }]);
  assert.ok(gold.mult > 1.1, `gold (overselling) should be hot, got ${gold.mult}`);
  const none = m.traitDemand([{ k: "Accessory", v: "None" }]);
  assert.equal(none.mult, 1, "a trait at/under its prevalence does not add");
});

test("trait demand never subtracts and is capped", () => {
  const sales = [];
  for (let i = 0; i < 20; i++) sales.push({ rank: 100 + i, price: 20, ageDays: 2, traits: [{ k: "X", v: "Hot" }] });
  const freq = { x: { hot: 1, cold: 9999 } }; // Hot ultra-rare but dominating sales -> huge ratio
  const m = buildCompsModel(sales, 10000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  const hot = m.traitDemand([{ k: "X", v: "Hot" }]);
  assert.ok(hot.mult >= 1 && hot.mult <= 1.6, `clamped to [1,1.6], got ${hot.mult}`);
});

test("valueOf multiplies curve by trait demand", () => {
  const sales = [];
  for (let i = 0; i < 10; i++) sales.push({ rank: 300 + i, price: 30, ageDays: 5, traits: [{ k: "Hat", v: "Gold" }] });
  for (let i = 0; i < 10; i++) sales.push({ rank: 305 + i, price: 30, ageDays: 5, traits: [{ k: "Hat", v: "Plain" }] });
  const freq = { hat: { gold: 100, plain: 900 } };
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  const v = m.valueOf(305, [{ k: "Hat", v: "Gold" }]);
  assert.ok(v.value >= v.curve, "trait demand only raises value");
  assert.match(v.basis, /curve/);
});

test("recency: a fresh high sale outweighs a stale low one at the same rank", () => {
  const sales = [
    { rank: 500, price: 2, ageDays: 700 },
    { rank: 500, price: 20, ageDays: 1 },
    { rank: 480, price: 19, ageDays: 1 },
    { rank: 520, price: 21, ageDays: 1 },
  ];
  const m = buildCompsModel(sales, 1000, { floor: 2, rarityFactor: () => 0 });
  assert.ok(m.curveValue(500) >= 15, `expected fresh ~20, got ${m.curveValue(500)}`);
});

test("rarity-monotone: a cheap deal in a rare band never inverts the tiers (rarer >= less-rare)", () => {
  // Normal-priced sales across the collection, PLUS two lucky-cheap sales in the rare (low-rank) band.
  const sales = [];
  for (let r = 50; r <= 900; r += 50) sales.push({ rank: r, price: (60 / r) * 30 + 6, ageDays: 20 });
  // Two recent below-market buys at rank ~120 (an "Epic" band) — the kind that used to bend the curve down.
  sales.push({ rank: 120, price: 7, ageDays: 1 });
  sales.push({ rank: 125, price: 7.5, ageDays: 1 });
  const m = buildCompsModel(sales, 1000, { floor: 6, rarityFactor: (p) => (p <= 2 ? 6 : p <= 8 ? 2 : p <= 30 ? 0.4 : 0) });
  // The rare band (rank ~120) must NOT be valued below a less-rare band (rank ~400/700), despite the cheap sales.
  assert.ok(m.curveValue(120) >= m.curveValue(400) - 1e-9, `rare(120)=${m.curveValue(120)} should be >= less-rare(400)=${m.curveValue(400)}`);
  assert.ok(m.curveValue(400) >= m.curveValue(700) - 1e-9, "curve must be non-increasing in rank");
  // And globally non-increasing across a sweep.
  let prev = Infinity;
  for (let r = 1; r <= 1000; r += 25) { const v = m.curveValue(r); assert.ok(v <= prev + 1e-9, `non-increasing at rank ${r}`); prev = v; }
});

// ── Robustness guards (external review hardening) ────────────────────────────────────────────────
test("winsorize: one extreme outlier sale can't blow up the curve level", () => {
  const sales = [];
  for (let i = 0; i < 12; i++) sales.push({ rank: 500 + i, price: 10, ageDays: 5 });
  sales.push({ rank: 506, price: 1000, ageDays: 1 }); // fat-finger / wash outlier
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: () => 0 });
  assert.ok(m.curveValue(506) < 30, `outlier should be winsorized out; got ${m.curveValue(506)}`);
});

test("rare-tail: value extrapolates LINEARLY beyond the rarest actual sale (no c·rf^2 runaway)", () => {
  const rf = (p) => 100 - p; // supply 1000: rank r -> percentile 0.1r -> rf = 100 - 0.1r (linear in rank)
  const sales = [];
  for (let r = 900; r <= 990; r += 10) sales.push({ rank: r, price: 20, ageDays: 5 }); // rf 10..1 => rfMax 10
  const m = buildCompsModel(sales, 1000, { floor: 1, rarityFactor: rf });
  const v100 = m.curveValue(100), v300 = m.curveValue(300), v500 = m.curveValue(500); // rf 90,70,50 (> rfMax)
  assert.ok(Math.abs(v100 - 2 * v300 + v500) < 1e-6, `tail must be linear; 2nd diff=${v100 - 2 * v300 + v500}`);
  assert.ok(v100 >= v300 && v300 >= v500, "rarer still valued >= less-rare in the tail");
});

test("trait ratio is capped (rare-trait double-count / wash guard)", () => {
  const sales = [];
  for (let i = 0; i < 20; i++) sales.push({ rank: 100 + i, price: 20, ageDays: 2, traits: [{ k: "X", v: "Hot" }] });
  const freq = { x: { hot: 1, cold: 99999 } }; // uncapped ratio would be in the thousands
  const m = buildCompsModel(sales, 100000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  const hot = m.traitDemand([{ k: "X", v: "Hot" }]);
  assert.ok(hot.top && hot.top.ratio <= 6 + 1e-9, `ratio must be capped at 6; got ${hot.top && hot.top.ratio}`);
});

test("minTraitN raised to 4: three sales of a trait are not enough to register demand", () => {
  const sales = [];
  for (let i = 0; i < 3; i++) sales.push({ rank: 100 + i, price: 20, ageDays: 2, traits: [{ k: "Y", v: "Rare" }] });
  const freq = { y: { rare: 5, common: 995 } };
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  assert.equal(m.traitDemand([{ k: "Y", v: "Rare" }]).mult, 1, "3 sales < minTraitN(4) => no premium");
});
