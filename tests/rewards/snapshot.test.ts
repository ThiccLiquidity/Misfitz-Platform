import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { settleUnattributed } from "../../src/lib/rewards/settle";
import { operatorPlanFromSettlement } from "../../src/lib/rewards/operator";
import { allocateDrip, weighHoldings } from "../../src/lib/rewards/allocator";
import { toSnapshotDTO, toOperatorDTO, leaderboardWallets, buildWalletMap, type ProfileMap } from "../../src/lib/rewards/snapshotSerialize";
import { toSale, type RawSale } from "../../src/lib/rewards/detect";

const raw = (o: Partial<RawSale> & { offerId: string; nftId: string; priceXch: number; soldAt: number }): RawSale => o;
const A = (c: string) => "xch1" + c.repeat(58);

function fixture() {
  const epochResult = computeEpoch([
    toSale(raw({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: A("a"), seller: A("b") }), null),
    toSale(raw({ offerId: "s2", nftId: "n2", priceXch: 60, soldAt: 2 }), null), // unattributed -> burn
  ], [], 0, 10);
  const settlement = settleUnattributed(epochResult);
  const operator = operatorPlanFromSettlement(epochResult, settlement);
  const drip = allocateDrip(weighHoldings([
    { wallet: A("a"), rank: 2, supply: 1000 },
    { wallet: A("z"), rank: 900, supply: 1000 },
  ]), BigInt(40_000_000_000));
  return { epochResult, settlement, operator, drip };
}

test("toSnapshotDTO: money fields are STRINGS that round-trip; uses settled figures; NO operator block", () => {
  const f = fixture();
  const dto = toSnapshotDTO({ colId: "col1x", epoch: "2026-07", status: "mtd", computedAt: 123, truncated: false, ...f });
  // operator is NOT in the public snapshot (it moved to the authed operator route)
  assert.equal("operator" in dto, false);
  // all public money is a string
  for (const v of [dto.trader.totalRoyaltyMojos, dto.trader.rewardPotMojos, dto.trader.burnMojos, dto.drip.dripUnits]) {
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

test("toOperatorDTO: operator actions serialize as strings; solvent split", () => {
  const f = fixture();
  const ops = toOperatorDTO({ colId: "col1x", epoch: "2026-07", status: "mtd", computedAt: 123, operator: f.operator });
  for (const v of [ops.operator.moveToHotWalletMojos, ops.operator.forRewardMojos, ops.operator.forBurnMojos, ops.operator.keepArtistMojos]) {
    assert.equal(typeof v, "string");
    assert.equal(BigInt(v).toString(), v);
  }
  // hot-wallet move = reward + burn (artist stays behind)
  assert.equal(
    BigInt(ops.operator.moveToHotWalletMojos),
    BigInt(ops.operator.forRewardMojos) + BigInt(ops.operator.forBurnMojos),
  );
});

test("leaderboardWallets: returns the top wallets the DTO will show (traders by XCH, holders by tokens)", () => {
  const f = fixture();
  const { traders, holders } = leaderboardWallets(f.settlement, f.drip);
  assert.ok(traders.includes(A("a")), "verified trader A(a) is on the trader board");
  assert.ok(traders.every((w) => !w.startsWith("unknown-")), "no placeholder wallets");
  assert.ok(holders.includes(A("a")), "top holder A(a) present");
  // holders sorted by token drip desc: A(a) (rank 2) drips more than A(z) (rank 900)
  assert.equal(holders[0], A("a"));
});

test("toSnapshotDTO: attaches resolved name+avatar to leaderboard entries by full wallet", () => {
  const f = fixture();
  const profiles: ProfileMap = new Map([[A("a"), { name: "Alice", avatarUrl: "https://x/a.webp" }]]);
  const dto = toSnapshotDTO({ colId: "col1x", epoch: "2026-07", status: "mtd", computedAt: 1, truncated: false, ...f, profiles });
  const aliceHolder = dto.drip.topHolders.find((h) => h.name === "Alice");
  assert.ok(aliceHolder, "A(a) resolved to Alice on the holder board");
  assert.equal(aliceHolder.avatarUrl, "https://x/a.webp");
  // an unresolved wallet has null identity (UI falls back to the truncated address)
  const other = dto.drip.topHolders.find((h) => h.name !== "Alice");
  assert.ok(other && other.name === null && other.avatarUrl === null);
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
