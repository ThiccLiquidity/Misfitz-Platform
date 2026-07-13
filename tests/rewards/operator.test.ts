import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { operatorPlan } from "../../src/lib/rewards/operator";
import { XCH, toSale, type RawSale } from "../../src/lib/rewards/detect";

const raw = (o: Partial<RawSale> & { offerId: string; nftId: string; priceXch: number; soldAt: number }): RawSale => o;

test("operatorPlan: hot-wallet transfer = reward pot + burn pot; artist stays; sums to royalty", () => {
  // Two fair sales (no bonus): 100 XCH (alice buys from bob) + 40 XCH (bob buys from carol).
  const sales = [
    toSale(raw({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: "alice", seller: "bob" }), null),
    toSale(raw({ offerId: "s2", nftId: "n2", priceXch: 40, soldAt: 2, buyer: "bob", seller: "carol" }), null),
  ];
  const r = computeEpoch(sales, [], 0, 10);
  const p = operatorPlan(r);
  assert.equal(p.moveToHotWalletMojos, r.rewardPotMojos + r.burnMojos);
  assert.equal(p.forRewardMojos, r.rewardPotMojos);
  assert.equal(p.forBurnMojos, r.burnMojos);
  assert.equal(p.keepArtistMojos, r.artistMojos);
  // Invariant: move + keep === total royalty (every mojo accounted for).
  assert.equal(p.moveToHotWalletMojos + p.keepArtistMojos, r.totalRoyaltyMojos);
  // Royalty = 10% of 140 = 14; artist = 1% of 140 = 1.4; hot-wallet move = 12.6.
  assert.equal(r.totalRoyaltyMojos, XCH(14));
  assert.equal(p.keepArtistMojos, XCH(1.4));
  assert.equal(p.moveToHotWalletMojos, XCH(12.6));
});
