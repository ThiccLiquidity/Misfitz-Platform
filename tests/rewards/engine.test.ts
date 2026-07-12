import { test } from "node:test";
import assert from "node:assert/strict";
import { perSaleSlices, computeEpoch, distributeChia } from "@/lib/rewards/engine";
import { mkSale, xch } from "@/lib/rewards/mock";

test("per-sale slices: fair sale burns 4%, sums exactly to royalty", () => {
  const s = mkSale({ id: "x", nftId: "n", buyer: "a", seller: "b", priceXch: 100, bonusWinner: "none" });
  const { artist, buyerReward, sellerReward, bonus, burn } = perSaleSlices(s);
  assert.equal(artist, xch(1));        // 1% of 100
  assert.equal(buyerReward, xch(2.5)); // 2.5%
  assert.equal(sellerReward, xch(2.5));
  assert.equal(bonus, xch(0));
  assert.equal(burn, xch(4));          // fair -> 4%
  assert.equal(artist + buyerReward + sellerReward + bonus + burn, s.royaltyMojos);
});

test("per-sale slices: tagged sale burns 1.5%, bonus 2.5%", () => {
  const s = mkSale({ id: "x", nftId: "n", buyer: "a", seller: "b", priceXch: 100, bonusWinner: "buyer" });
  const sl = perSaleSlices(s);
  assert.equal(sl.bonus, xch(2.5));
  assert.equal(sl.burn, xch(1.5));
  assert.equal(sl.artist + sl.buyerReward + sl.sellerReward + sl.bonus + sl.burn, s.royaltyMojos);
});

// The exact worked example agreed in design: two sales, three traders.
test("Alice/Bob/Carol worked example matches the agreed numbers", () => {
  const sales = [
    mkSale({ id: "s1", nftId: "nA", buyer: "alice", seller: "bob",   priceXch: 100, bonusWinner: "buyer", soldAt: 1 }),
    mkSale({ id: "s2", nftId: "nB", buyer: "bob",   seller: "carol", priceXch: 40,  bonusWinner: "none",  soldAt: 2 }),
  ];
  const r = computeEpoch(sales, [], 0, 100);
  const by = (w: string) => r.payouts.find((p) => p.wallet === w)!;

  assert.equal(by("alice").buyerReward, xch(2.5));
  assert.equal(by("alice").bonus, xch(2.5));
  assert.equal(by("alice").total, xch(5));

  assert.equal(by("bob").sellerReward, xch(2.5));
  assert.equal(by("bob").buyerReward, xch(1));
  assert.equal(by("bob").total, xch(3.5));

  assert.equal(by("carol").total, xch(1));

  assert.equal(r.artistMojos, xch(1.4));
  assert.equal(r.burnMojos, xch(3.1));
  assert.equal(r.rewardPotMojos, xch(9.5));
  assert.equal(r.totalRoyaltyMojos, xch(14));
  assert.equal(r.solvent, true);
});

test("distributeChia: proportional, sums EXACTLY to $CHIA received (dust to largest)", () => {
  const sales = [
    mkSale({ id: "s1", nftId: "nA", buyer: "alice", seller: "bob",   priceXch: 100, bonusWinner: "buyer", soldAt: 1 }),
    mkSale({ id: "s2", nftId: "nB", buyer: "bob",   seller: "carol", priceXch: 40,  bonusWinner: "none",  soldAt: 2 }),
  ];
  const r = computeEpoch(sales, [], 0, 100);
  const chia = BigInt(1000);
  const dist = distributeChia(r.payouts, r.rewardPotMojos, chia);
  let sum = BigInt(0);
  for (const v of dist.values()) sum += v;
  assert.equal(sum, chia); // exact, no leakage
  assert.ok((dist.get("alice") ?? BigInt(0)) > (dist.get("carol") ?? BigInt(0)));
});

test("rounding dust always lands in burn (odd royalty stays exactly solvent)", () => {
  const s = mkSale({ id: "x", nftId: "n", buyer: "a", seller: "b", priceXch: 0.000001, bonusWinner: "buyer" });
  const r = computeEpoch([s], [], 0, 10);
  assert.equal(r.artistMojos + r.burnMojos + r.rewardPotMojos, r.totalRoyaltyMojos);
  assert.equal(r.solvent, true);
});
