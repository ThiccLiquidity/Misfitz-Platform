import { test } from "node:test";
import assert from "node:assert/strict";
import {
  XCH,
  bonusWinnerFor,
  toSale,
  inWindow,
  saleSignals,
  listSignals,
  buildEpochInputs,
  type RawSale,
} from "../../src/lib/rewards/detect";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { MOJOS_PER_XCH } from "../../src/lib/rewards/types";

const raw = (o: Partial<RawSale> & { offerId: string; nftId: string; priceXch: number; soldAt: number }): RawSale => o;

test("XCH converts exactly via string (no float drift)", () => {
  assert.equal(XCH(1), MOJOS_PER_XCH);
  assert.equal(XCH(0.1), BigInt(100_000_000_000));
  assert.equal(XCH(1.234567890123), BigInt(1_234_567_890_123));
  assert.equal(XCH(0), BigInt(0));
  assert.equal(XCH(-5), BigInt(0)); // junk clamps to 0
});

test("bonusWinnerFor mirrors the deal score: buyer on steals, seller on premiums, none when fair/unknown", () => {
  assert.equal(bonusWinnerFor(5, 10), "buyer");    // paid half of value -> steal
  assert.equal(bonusWinnerFor(20, 10), "seller");  // paid double -> premium to seller
  assert.equal(bonusWinnerFor(10, 10), "none");    // fair
  assert.equal(bonusWinnerFor(10, null), "none");  // no FV -> no bonus
  assert.equal(bonusWinnerFor(10, 0), "none");
});

test("toSale: royalty is exactly 10% of price; placeholders when unattributed", () => {
  const s = toSale(raw({ offerId: "o1", nftId: "nft1abc", priceXch: 100, soldAt: 1_000 }), 90);
  assert.equal(s.priceMojos, BigInt(100) * MOJOS_PER_XCH);
  assert.equal(s.royaltyMojos, BigInt(10) * MOJOS_PER_XCH); // 10% of 100
  assert.equal(s.bonusWinner, "seller"); // 100 paid vs 90 FV -> premium
  assert.equal(s.buyer, "unknown-buyer:o1");
  assert.equal(s.seller, "unknown-seller:o1");
});

test("inWindow uses the finality-shifted half-open window [start-fin, end-fin)", () => {
  const start = 1_000_000, end = 2_000_000, fin = 10 * 60_000;
  const at = (t: number) => inWindow(raw({ offerId: "x", nftId: "n", priceXch: 1, soldAt: t }), start, end, fin);
  assert.equal(at(start - fin), true);      // lower bound inclusive
  assert.equal(at(start - fin - 1), false); // just before the window
  assert.equal(at(end - fin), false);       // upper bound exclusive
  assert.equal(at(end - fin - 1), true);    // just inside the window
  assert.equal(at(end - 1), false);         // last-minute sale rolls to the NEXT epoch (not dropped)
});

test("buildEpochInputs: counts final in-window sales, emits sale+list signals", () => {
  const start = 0, end = 1_000_000, fin = 0;
  const raws = [
    raw({ offerId: "s1", nftId: "nftA", priceXch: 100, soldAt: 100 }),
    raw({ offerId: "s2", nftId: "nftB", priceXch: 40, soldAt: 200 }),
    raw({ offerId: "s3", nftId: "nftC", priceXch: 10, soldAt: end + 5 }), // out of window -> not counted
  ];
  const fv = (r: RawSale) => (r.nftId === "nftA" ? 200 : null); // nftA is a steal (buyer bonus), rest fair
  const { sales, signals } = buildEpochInputs(raws, start, end, fv, [{ nftId: "nftZ", priceXch: 3, at: 500 }], fin);
  assert.equal(sales.length, 2); // s3 excluded
  assert.equal(sales[0].bonusWinner, "buyer");
  // signals: both in-window sales + the one listing (s3 is after end, excluded from signals too)
  assert.equal(signals.filter((s) => s.kind === "sale").length, 2);
  assert.equal(signals.filter((s) => s.kind === "list").length, 1);
});

test("detect -> engine: a cheap relist before payout voids the buyer bonus into the burn", () => {
  const start = 0, end = 1_000_000, fin = 0;
  // Buyer scoops nftA for 100 (FV 200 -> buyer bonus), then lists it for 60 before payout -> void.
  const raws = [raw({ offerId: "s1", nftId: "nftA", priceXch: 100, soldAt: 100, buyer: "alice", seller: "bob" })];
  const listings = [{ nftId: "nftA", priceXch: 60, at: 500 }];
  const fv = () => 200;
  const inputs = buildEpochInputs(raws, start, end, fv, listings, fin);
  const r = computeEpoch(inputs.sales, inputs.signals, start, end);
  assert.equal(r.solvent, true);
  const bonus = r.bonuses.find((b) => b.saleId === "s1");
  assert.ok(bonus && bonus.status === "voided", "buyer bonus should be voided by the cheap relist");
  // Alice still keeps her base 2.5% buyer reward (never clawed back).
  const alice = r.payouts.find((p) => p.wallet === "alice");
  assert.ok(alice && alice.buyerReward > BigInt(0) && alice.bonus === BigInt(0));
});

test("seller premium bonus is FINAL — a cheap relist does NOT void it (spec §4)", () => {
  const start = 0, end = 1_000_000, fin = 0;
  // Seller sold ABOVE value (price 100 vs FV 50 -> seller premium). Buyer then relists cheap.
  const raws = [raw({ offerId: "s1", nftId: "nftA", priceXch: 100, soldAt: 100, buyer: "alice", seller: "bob" })];
  const listings = [{ nftId: "nftA", priceXch: 40, at: 500 }];
  const inputs = buildEpochInputs(raws, start, end, () => 50, listings, fin);
  assert.equal(inputs.sales[0].bonusWinner, "seller");
  const r = computeEpoch(inputs.sales, inputs.signals, start, end);
  const bonus = r.bonuses.find((b) => b.saleId === "s1");
  assert.ok(bonus && bonus.status === "paid", "seller premium bonus must stay paid, never voided");
  const bob = r.payouts.find((p) => p.wallet === "bob");
  assert.ok(bob && bob.bonus > BigInt(0));
});

test("saleSignals / listSignals map straight through with correct kinds", () => {
  assert.deepEqual(
    saleSignals([raw({ offerId: "x", nftId: "n1", priceXch: 2, soldAt: 5 })]),
    [{ nftId: "n1", priceMojos: BigInt(2) * MOJOS_PER_XCH, at: 5, kind: "sale" }],
  );
  assert.deepEqual(
    listSignals([{ nftId: "n2", priceXch: 3, at: 9 }]),
    [{ nftId: "n2", priceMojos: BigInt(3) * MOJOS_PER_XCH, at: 9, kind: "list" }],
  );
});
