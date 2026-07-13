import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { settleUnattributed } from "../../src/lib/rewards/settle";
import { operatorPlan } from "../../src/lib/rewards/operator";
import { allocateDrip, weighHoldings } from "../../src/lib/rewards/allocator";
import { toSnapshotDTO, buildWalletMap } from "../../src/lib/rewards/snapshotSerialize";
import { toSale, type RawSale } from "../../src/lib/rewards/detect";

const raw = (o: Partial<RawSale> & { offerId: string; nftId: string; priceXch: number; soldAt: number }): RawSale => o;
const A = (c: string) => "xch1" + c.repeat(58);

function fixture() {
  const epochResult = computeEpoch([
    toSale(raw({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: A("a"), seller: A("b") }), null),
    toSale(raw({ offerId: "s2", nftId: "n2", priceXch: 60, soldAt: 2 }), null), // unattributed -> burn
  ], [], 0, 10);
  const settlement = settleUnattributed(epochResult);
  const operator = operatorPlan(epochResult);
  const drip = allocateDrip(weighHoldings([
    { wallet: A("a"), rank: 2, supply: 1000 },
    { wallet: A("z"), rank: 900, supply: 1000 },
  ]), BigInt(40_000_000_000));
  return { epochResult, settlement, operator, drip };
}

test("toSnapshotDTO: money fields are STRINGS that round-trip; uses settled figures; solvent", () => {
  const f = fixture();
  const dto = toSnapshotDTO({ colId: "col1x", epoch: "2026-07", status: "mtd", computedAt: 123, truncated: false, ...f });
  // all money is a string
  for (const v of [dto.trader.totalRoyaltyMojos, dto.trader.rewardPotMojos, dto.trader.burnMojos, dto.operator.moveToHotWalletMojos, dto.drip.dripUnits]) {
    assert.equal(typeof v, "string");
    assert.equal(BigInt(v).toString(), v); // parses back exactly
  }
  // settled figures: verified reward pot + adjusted burn (unattributed routed in)
  assert.equal(dto.trader.rewardPotMojos, f.settlement.verifiedRewardPotMojos.toString());
  assert.equal(dto.trader.burnMojos, f.settlement.adjustedBurnMojos.toString());
  assert.equal(dto.meta.unattributedCount, f.settlement.droppedRecipients);
  assert.ok(dto.meta.unattributedCount >= 1);
  // solvency visible in the DTO: royalty == artist + burn + rewardPot
  assert.equal(
    BigInt(dto.trader.artistMojos) + BigInt(dto.trader.burnMojos) + BigInt(dto.trader.rewardPotMojos),
    BigInt(dto.trader.totalRoyaltyMojos),
  );
  // no unattributed placeholder leaks into the public leaderboard
  assert.ok(dto.trader.topPayouts.every((p) => !p.walletTrunc.startsWith("unknown-")));
  // survives JSON
  assert.deepEqual(JSON.parse(JSON.stringify(dto)).trader.rewardPotMojos, dto.trader.rewardPotMojos);
});

test("buildWalletMap: combines drip tokens + trader XCH per wallet; strings", () => {
  const f = fixture();
  const map = buildWalletMap(f.drip, f.settlement);
  const alice = map[A("a")];
  assert.ok(alice, "wallet A(a) present");
  assert.equal(typeof alice.tokenUnits, "string");
  assert.ok(BigInt(alice.tokenUnits) > BigInt(0), "has drip tokens");
  assert.ok(BigInt(alice.traderTotalMojos) > BigInt(0), "A(a) is a verified trader payee -> has XCH owed");
});
