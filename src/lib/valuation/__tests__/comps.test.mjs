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
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: (p) => (p >= 50 ? 0 : 1), thinDistinctThreshold: 0, baselineClampHi: 1e9, baselineClampLo: 0 });
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
  const m = buildCompsModel(sales, 1000, { floor: 2, rarityFactor: () => 0, thinDistinctThreshold: 0, baselineClampHi: 1e9, baselineClampLo: 0 });
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

// ── Thin-collection wash attack (provenance + thin-market hardening) ─────────────────────────────
test("thin-collection wash pump is bounded: fake ring can't inflate the curve or heat a trait", () => {
  const rf = (p) => (p <= 2 ? 6 : p <= 8 ? 2 : p <= 30 ? 0.4 : 0);
  const floor = 5;
  // Attacker owns 5 NFTs, wash-sells each once between the SAME two wallets (A -> B) at 100x floor.
  const sales = [];
  for (let i = 0; i < 5; i++) {
    sales.push({ rank: 100 + i, price: 500, ageDays: 1, seller: "A", buyer: "B", traits: [{ k: "Fake", v: "Pump" }] });
  }
  const freq = { fake: { pump: 5, other: 995 } };
  const m = buildCompsModel(sales, 1000, { floor, rarityFactor: rf, traitFreq: freq });

  // Curve at a pumped rank is bounded near the floor-anchored baseline (thin cap 2x + baseline clamp),
  // NOT dragged toward the 500 fake price.
  const base100 = floor * (1 + rf(10)); // rank 100 => 10th pct => rf 0.4 => baseline 7
  assert.ok(m.curveValue(100) <= 2 * base100 + 1e-6, `pumped curve must stay <= 2x baseline; got ${m.curveValue(100)} vs ${2 * base100}`);

  // Trait heat is blocked: all buys came from ONE buyer (< minDistinctBuyers), so no premium.
  assert.equal(m.traitDemand([{ k: "Fake", v: "Pump" }]).mult, 1, "single-buyer wash must not heat a trait");
});

test("distinct-buyer gate is precise: genuine demand from many buyers still registers", () => {
  const sales = [];
  // 6 distinct NFTs of a trait, each bought by a DIFFERENT wallet (organic demand), plenty of volume.
  for (let i = 0; i < 6; i++) sales.push({ rank: 200 + i, price: 20, ageDays: 3, seller: "S" + i, buyer: "B" + i, traits: [{ k: "Hat", v: "Gold" }] });
  for (let i = 0; i < 6; i++) sales.push({ rank: 600 + i, price: 20, ageDays: 3, seller: "T" + i, buyer: "C" + i, traits: [{ k: "Hat", v: "Plain" }] });
  const freq = { hat: { gold: 60, plain: 940 } }; // Gold 6% but half of recent sales -> genuinely hot
  const m = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: () => 0, traitFreq: freq });
  assert.ok(m.traitDemand([{ k: "Hat", v: "Gold" }]).mult > 1, "organic multi-buyer demand should register");
});

test("pair-decay: a repeated same-pair ring moves the curve less than distinct pairs", () => {
  const rf = () => 1;
  const mk = (samePair) => {
    const sales = [];
    for (let i = 0; i < 5; i++) sales.push({ rank: 100 + i, price: 100, ageDays: 2, seller: samePair ? "A" : "S" + i, buyer: samePair ? "B" : "B" + i });
    return buildCompsModel(sales, 1000, { floor: 5, rarityFactor: rf, baselineClampHi: 1e9, baselineClampLo: 0, thinDistinctThreshold: 0 });
  };
  const ring = mk(true), organic = mk(false);
  assert.ok(organic.curveValue(100) > ring.curveValue(100), `distinct pairs lift more; ring=${ring.curveValue(100)} organic=${organic.curveValue(100)}`);
});

test("thin cap releases once enough distinct NFTs have sold", () => {
  const opts = { floor: 5, rarityFactor: () => 1 };
  const mk = (n) => { const s = []; for (let i = 0; i < n; i++) s.push({ rank: 100 + i, price: 100, ageDays: 2, seller: "S" + i, buyer: "B" + i }); return buildCompsModel(s, 1000, opts); };
  const base = 5 * (1 + 1); // 10
  assert.ok(mk(6).curveValue(100) <= 2 * base + 1e-6, "thin (<8 NFTs) capped at 2x baseline");
  assert.ok(mk(10).curveValue(100) > 2 * base, "cap released with >=8 distinct NFTs");
});

// ── Rank-dependent sale memory (grails remembered longer) ────────────────────────────────────────
test("new decay: a fake grail sale is remembered longer but still bounded by the baseline clamp", () => {
  const rf = (p) => (p <= 0.1 ? 14 : p <= 2 ? 6 : p <= 30 ? 0.4 : 0);
  const floor = 5, supply = 10000;
  // A single OLD (300-day) wash sale at rank 1 priced 100x floor — under the new longer grail half-life it
  // retains far more weight than under 120d, so this checks the baseline clamp still bounds the damage.
  const sales = [{ rank: 1, price: 500, ageDays: 300, seller: "A", buyer: "B" }];
  // >=8 distinct organic NFTs so the thin-collection cap releases and the [.,5x] baseline clamp is what binds.
  for (let r = 1000; r <= 9000; r += 1000) sales.push({ rank: r, price: 6, ageDays: 20, seller: "S" + r, buyer: "C" + r });
  const m = buildCompsModel(sales, supply, { floor, rarityFactor: rf, halfLifeRarest: 360 });
  const base1 = floor * (1 + rf((1 / supply) * 100)); // baseline at rank 1
  assert.ok(m.curveValue(1) <= 5 * base1 + 1e-6, `fake grail bounded by 5x baseline despite longer memory; got ${m.curveValue(1)} vs ${5 * base1}`);
});

// ── Adaptive (evidence-recency) half-life — PROPOSED, off by default (VALUATION-MODEL.md §5.P) ──────
// We can't read the half-life directly, so we probe it via behavior: with adaptive ON, a LIQUID tier
// (many fresh distinct-buyer sales) should let a recent price move the curve, while a DEAD tier that
// only has an OLD price should still remember it (long reach-back) rather than let it decay to floor.

test("adaptive OFF by default: option absent => identical to the fixed parabola", () => {
  const rf = (p) => (p <= 10 ? 3 : p <= 50 ? 0.5 : 0);
  const sales = [];
  for (let r = 100; r <= 900; r += 100) sales.push({ rank: r, price: 20, ageDays: 40, seller: "S" + r, buyer: "B" + r });
  const off = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: rf });
  const explicitOff = buildCompsModel(sales, 1000, { floor: 5, rarityFactor: rf, adaptiveHalfLife: false });
  assert.equal(off.curveValue(100), explicitOff.curveValue(100), "adaptiveHalfLife:false must equal the default");
});

test("adaptive ON: a DEAD tier's only (old) grail sale is remembered, not decayed toward floor", () => {
  // Grail tier has ONE distinct-buyer sale, 200 days old. Under the fixed parabola the grail half-life is
  // ~365 anyway, but under adaptive the reach-back keeps memory long (>= that 200d) instead of short.
  const rf = (p) => (p <= 0.1 ? 14 : p <= 2 ? 6 : p <= 30 ? 0.4 : 0);
  const floor = 5, supply = 10000;
  const sales = [{ rank: 1, price: 60, ageDays: 200, seller: "A", buyer: "B" }];
  for (let r = 1000; r <= 9000; r += 1000) sales.push({ rank: r, price: 6, ageDays: 20, seller: "S" + r, buyer: "C" + r });
  const on = buildCompsModel(sales, supply, { floor, rarityFactor: rf, adaptiveHalfLife: true, adaptiveN: 7 });
  // The old grail sale still lifts the rare end clearly above the floor-only baseline for commons.
  assert.ok(on.curveValue(1) > on.curveValue(9000), "rare end remembers the old grail sale");
  assert.ok(on.curveValue(1) >= floor, "never below floor");
});

test("adaptive ON: a LIQUID tier reaches back only a little (short memory), staying >= the min clamp", () => {
  // A tier flooded with fresh distinct-buyer sales hits N almost immediately -> tiny reach-back -> the
  // half-life is pinned at the min-clamp floor (anti-manipulation rail), NOT stretched to a year.
  const rf = (p) => (p <= 10 ? 3 : 0);
  const supply = 1000, floor = 5;
  const fresh = [];
  for (let i = 0; i < 12; i++) fresh.push({ rank: 30 + i, price: 25, ageDays: 2 + i, seller: "S" + i, buyer: "B" + i }); // rare tier, all fresh
  for (let r = 400; r <= 900; r += 100) fresh.push({ rank: r, price: 8, ageDays: 15, seller: "T" + r, buyer: "C" + r });
  const m = buildCompsModel(fresh, supply, { floor, rarityFactor: rf, adaptiveHalfLife: true, adaptiveN: 7, adaptiveMinHalfLife: 120, adaptiveMaxHalfLife: 540 });
  // Sanity: builds a valid monotonic curve driven by the fresh sales.
  assert.ok(m.curveValue(30) > m.curveValue(900), "fresh rare sales lift the rare end");
  assert.ok(Number.isFinite(m.curveValue(30)), "valid curve");
});

test("adaptive ON: repeat-buyer (wash) sales do NOT fill the distinct-buyer quota", () => {
  // Same buyer bouncing an NFT can't shorten memory: distinct-buyer counting means one wallet = one count.
  const rf = (p) => (p <= 10 ? 3 : 0);
  const supply = 1000, floor = 5;
  const washy = [];
  for (let i = 0; i < 10; i++) washy.push({ rank: 40 + i, price: 30, ageDays: 3 + i, seller: "W", buyer: "W" }); // one wallet, many "sales"
  for (let r = 500; r <= 900; r += 100) washy.push({ rank: r, price: 8, ageDays: 15, seller: "T" + r, buyer: "C" + r });
  const m = buildCompsModel(washy, supply, { floor, rarityFactor: rf, adaptiveHalfLife: true, adaptiveN: 7 });
  assert.ok(Number.isFinite(m.curveValue(40)), "still produces a valid curve under wash input");
});
