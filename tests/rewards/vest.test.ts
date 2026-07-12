import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "@/lib/rewards/engine";
import { mkSale, mkSignal, xch } from "@/lib/rewards/mock";

const buy = () => mkSale({ id: "s", nftId: "n", buyer: "erin", seller: "dave", priceXch: 12, bonusWinner: "buyer", soldAt: 10 });

test("cheaper relist within window VOIDS the buyer bonus (-> burn)", () => {
  const r = computeEpoch([buy()], [mkSignal("n", 9, 20, "list")], 0, 100);
  const erin = r.payouts.find((p) => p.wallet === "erin");
  assert.equal(erin?.bonus ?? xch(0), xch(0));         // bonus not paid
  assert.equal(r.bonuses[0].status, "voided");
  assert.equal(r.burnMojos, xch(12 * 0.04)); // voided bonus burns like a fair sale: 1.5% base + 2.5% voided = 4%
  assert.equal(r.solvent, true);
});

test("higher relist keeps the bonus", () => {
  const r = computeEpoch([buy()], [mkSignal("n", 15, 20, "list")], 0, 100);
  assert.equal(r.payouts.find((p) => p.wallet === "erin")?.bonus, xch(12 * 0.025));
  assert.equal(r.bonuses[0].status, "paid");
});

test("equal-price relist keeps the bonus (strictly cheaper only)", () => {
  const r = computeEpoch([buy()], [mkSignal("n", 12, 20, "list")], 0, 100);
  assert.equal(r.bonuses[0].status, "paid");
});

test("a cheap signal for a DIFFERENT nft does not void", () => {
  const r = computeEpoch([buy()], [mkSignal("other", 1, 20)], 0, 100);
  assert.equal(r.bonuses[0].status, "paid");
});

test("signals outside (sale, payout] are ignored", () => {
  const before = computeEpoch([buy()], [mkSignal("n", 1, 5)], 0, 100);   // at 5 <= soldAt 10
  const after = computeEpoch([buy()], [mkSignal("n", 1, 200)], 0, 100, undefined, 100); // at 200 > payout 100
  assert.equal(before.bonuses[0].status, "paid");
  assert.equal(after.bonuses[0].status, "paid");
});

test("a cheap actual RESALE also voids", () => {
  const r = computeEpoch([buy()], [mkSignal("n", 8, 20, "sale")], 0, 100);
  assert.equal(r.bonuses[0].status, "voided");
});
