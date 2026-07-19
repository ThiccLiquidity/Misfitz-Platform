import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { settleUnattributed } from "../../src/lib/rewards/settle";
import { operatorPlanFromSettlement } from "../../src/lib/rewards/operator";
import { weighHoldings, allocateDrip } from "../../src/lib/rewards/allocator";
import { buildSettlementDoc } from "../../src/lib/rewards/settlementDoc";
import { TOKEN_TAIL_TBD } from "../../src/lib/rewards/manifest";
import type { Sale } from "../../src/lib/rewards/types";

const XCH = BigInt(1_000_000_000_000);
const sale = (id: string, buyer: string, seller: string, priceXch: number): Sale => ({
  id, nftId: `nft-${id}`, buyer, seller,
  priceMojos: BigInt(priceXch) * XCH,
  royaltyMojos: (BigInt(priceXch) * XCH * BigInt(1000)) / BigInt(10000), // 10% royalty
  bonusWinner: "none", soldAt: 1000,
});

function fixture(col = "col1abc", epoch = "2026-06") {
  const sales = [sale("a", "xch1buyer1", "xch1seller1", 10), sale("b", "xch1buyer2", "xch1seller1", 4)];
  const er = computeEpoch(sales, [], 0, 2000);
  const settlement = settleUnattributed(er);
  const operator = operatorPlanFromSettlement(er, settlement);
  const drip = allocateDrip(weighHoldings([
    { wallet: "xch1holderA", rank: 1, supply: 100 },
    { wallet: "xch1holderB", rank: 50, supply: 100 },
  ]), BigInt(1_000_000));
  return buildSettlementDoc({ collectionId: col, epochId: epoch, status: "final", generatedAt: 12345, truncated: false, epochResult: er, settlement, operator, drip });
}

test("settlement doc: move breakdown equals the operator plan and is solvent (move + artist === royalty)", () => {
  const d = fixture();
  const move = BigInt(d.move.toDistributionWalletMojos);
  const artist = BigInt(d.move.artistCutMojos);
  assert.equal((move + artist).toString(), d.move.totalRoyaltyMojos);
  assert.equal(BigInt(d.move.swapToChiaForRewardsMojos) + BigInt(d.move.buyTokenForBurnMojos), move);
  assert.equal(d.solvent, true);
});

test("settlement doc: per-wallet reward table sums to the verified payout pot", () => {
  const d = fixture();
  const sum = d.rewards.wallets.reduce((s, w) => s + BigInt(w.owedMojos), BigInt(0));
  assert.equal(sum.toString(), d.rewards.payoutPotMojos);
  // sorted desc by owed
  for (let i = 1; i < d.rewards.wallets.length; i++) {
    assert.ok(BigInt(d.rewards.wallets[i - 1].owedMojos) >= BigInt(d.rewards.wallets[i].owedMojos));
  }
});

test("settlement doc: $SNACKZ placeholder is flagged and carried into the drip manifest until minted", () => {
  const d = fixture();
  assert.equal(d.drip.tokenMinted, false);
  assert.equal(d.drip.manifest.asset.id, TOKEN_TAIL_TBD);
  assert.ok(d.drip.manifest.recipientCount > 0);
  assert.equal(d.drip.manifest.collectionId, "col1abc"); // colId threaded through for the ledger seam
});

test("settlement doc: recipient-list hash is deterministic and collection/epoch-scoped", () => {
  assert.equal(fixture("col1abc", "2026-06").recipientListHash, fixture("col1abc", "2026-06").recipientListHash);
  assert.notEqual(fixture("col1abc", "2026-06").recipientListHash, fixture("col1abc", "2026-07").recipientListHash);
  assert.notEqual(fixture("col1abc", "2026-06").recipientListHash, fixture("col1xyz", "2026-06").recipientListHash);
});
