import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch, perSaleSlices } from "@/lib/rewards/engine";
import { mkSale } from "@/lib/rewards/mock";
import type { BonusWinner, Sale } from "@/lib/rewards/types";

// Deterministic PRNG so the property test is reproducible.
function lcg(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }

test("solvency holds for 500 random epochs (allocated === received, exactly)", () => {
  const rnd = lcg(42);
  for (let iter = 0; iter < 500; iter++) {
    const n = 1 + Math.floor(rnd() * 40);
    const sales: Sale[] = [];
    for (let i = 0; i < n; i++) {
      const w: BonusWinner = rnd() < 0.4 ? "buyer" : rnd() < 0.6 ? "seller" : "none";
      sales.push(mkSale({
        id: `s${i}`, nftId: `n${i}`,
        buyer: `w${Math.floor(rnd() * 20)}`, seller: `w${Math.floor(rnd() * 20)}`,
        priceXch: Math.round(rnd() * 500 * 1e6) / 1e6, bonusWinner: w, soldAt: i,
      }));
    }
    const r = computeEpoch(sales, [], 0, n + 10);
    assert.equal(r.artistMojos + r.burnMojos + r.rewardPotMojos, r.totalRoyaltyMojos);
    assert.equal(r.solvent, true);
  }
});

test("a self-wash is always net-negative (earn < royalty paid)", () => {
  // Same wallet buys from itself, even winning the bonus: earns 5% (fair) or 7.5% (tagged) of price,
  // always less than the 10% royalty it paid.
  for (const bonus of ["none", "buyer", "seller"] as BonusWinner[]) {
    const s = mkSale({ id: "w", nftId: "n", buyer: "whale", seller: "whale", priceXch: 100, bonusWinner: bonus });
    const sl = perSaleSlices(s);
    const earned = sl.buyerReward + sl.sellerReward + sl.bonus; // whale is both sides
    assert.ok(earned < s.royaltyMojos, `wash earned ${earned} should be < royalty ${s.royaltyMojos}`);
  }
});
