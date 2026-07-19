import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLaunchAirdrop, finalizeAirdropManifest, GENESIS_AIRDROP_EPOCH } from "../../src/lib/rewards/airdrop";
import { verifyManifest } from "../../src/lib/rewards/manifestGuard";
import type { SnapshotNft } from "../../src/lib/rewards/allocator";

const UNITS = BigInt(100_000_000) * BigInt(1000); // 100M tokens at 3 decimals
const W = (c: string) => "xch1" + c.repeat(50);   // a WALLET_RE-valid lowercase bech32m-looking address

test("airdrop: excludes project wallet + its NFTs (case-insensitive), pays only external holders", () => {
  const holders: SnapshotNft[] = [
    { wallet: W("p"), rank: 5, supply: 100 },
    { wallet: W("p").toUpperCase(), rank: 6, supply: 100 }, // same wallet, upper-cased -> still excluded
    { wallet: W("a"), rank: 1, supply: 100 },
    { wallet: W("b"), rank: 100, supply: 100 },
  ];
  const r = buildLaunchAirdrop({ holders, airdropUnits: UNITS, excludeWallets: [W("p").toUpperCase()] });
  assert.equal(r.excludedNftCount, 2);
  assert.equal(r.eligibleNftCount, 2);
  assert.equal(r.unmatchedExcludes.length, 0);
  assert.ok(!r.wallets.some((w) => w.wallet.toLowerCase() === W("p")), "project wallet must never receive");
});

test("airdrop: normalizes holder wallets once (upper/lower collapse to one recipient)", () => {
  const holders: SnapshotNft[] = [
    { wallet: W("a"), rank: 1, supply: 100 },
    { wallet: W("a").toUpperCase(), rank: 2, supply: 100 }, // same wallet, must NOT split into two payees
  ];
  const r = buildLaunchAirdrop({ holders, airdropUnits: UNITS });
  assert.equal(r.holderCount, 1);
  assert.equal(r.wallets[0].nftCount, 2);
});

test("airdrop: empty/malformed owner is dropped, never allocated", () => {
  const holders: SnapshotNft[] = [
    { wallet: "", rank: 1, supply: 100 },
    { wallet: "   ", rank: 2, supply: 100 },
    { wallet: W("a"), rank: 3, supply: 100 },
  ];
  const r = buildLaunchAirdrop({ holders, airdropUnits: UNITS });
  assert.equal(r.invalidWalletNftCount, 2);
  assert.equal(r.eligibleNftCount, 1);
  assert.equal(r.excludedNftCount + r.eligibleNftCount + r.invalidWalletNftCount, holders.length);
});

test("airdrop: a mis-formed exclude entry (matches nothing) is surfaced for a halt", () => {
  const holders: SnapshotNft[] = [{ wallet: W("a"), rank: 1, supply: 100 }];
  const r = buildLaunchAirdrop({ holders, airdropUnits: UNITS, excludeWallets: [W("z")] }); // not present
  assert.deepEqual(r.unmatchedExcludes, [W("z")]);
});

test("airdrop: solvent by construction (sum === airdropUnits)", () => {
  const holders: SnapshotNft[] = Array.from({ length: 50 }, (_, i) => ({ wallet: W(String.fromCharCode(97 + (i % 7))), rank: i + 1, supply: 50 }));
  const r = buildLaunchAirdrop({ holders, airdropUnits: UNITS });
  assert.equal(r.wallets.reduce((s, w) => s + w.tokenUnits, BigInt(0)), UNITS);
  assert.equal(r.solvent, true);
});

test("airdrop: exact dust lands on the largest holder (sum stays exact)", () => {
  const holders: SnapshotNft[] = [
    { wallet: W("a"), rank: 1, supply: 3 },
    { wallet: W("b"), rank: 2, supply: 3 },
    { wallet: W("c"), rank: 3, supply: 3 },
  ];
  const r = buildLaunchAirdrop({ holders, airdropUnits: BigInt(100) });
  assert.equal(r.wallets.reduce((s, w) => s + w.tokenUnits, BigInt(0)), BigInt(100));
});

test("airdrop: rarity-weighted — rarer holder gets more", () => {
  const r = buildLaunchAirdrop({ holders: [
    { wallet: W("r"), rank: 1, supply: 1000 },
    { wallet: W("c"), rank: 1000, supply: 1000 },
  ], airdropUnits: UNITS });
  const rare = r.wallets.find((w) => w.wallet === W("r"))!;
  const common = r.wallets.find((w) => w.wallet === W("c"))!;
  assert.ok(rare.tokenUnits > common.tokenUnits);
});

test("airdrop: zero eligible with a positive bucket THROWS (operator error)", () => {
  assert.throws(() => buildLaunchAirdrop({ holders: [], airdropUnits: UNITS }));
  assert.throws(() => buildLaunchAirdrop({ holders: [{ wallet: W("p"), rank: 1, supply: 10 }], airdropUnits: UNITS, excludeWallets: [W("p")] }));
});

test("airdrop: finalized manifest passes the bot guard (drip kind, collectionId, asset bound)", () => {
  const holders: SnapshotNft[] = [
    { wallet: W("a"), rank: 25, supply: 100 },
    { wallet: W("b"), rank: 50, supply: 100 },
    { wallet: W("c"), rank: 75, supply: 100 },
    { wallet: W("d"), rank: 100, supply: 100 },
  ];
  const ad = buildLaunchAirdrop({ holders, airdropUnits: UNITS });
  const assetId = "a".repeat(64); // stand-in $SNACKZ tail
  const m = finalizeAirdropManifest(ad, assetId, (h) => "sig:" + h, "col1misfitz");
  assert.equal(m.epochId, GENESIS_AIRDROP_EPOCH);
  assert.equal(m.kind, "drip");
  assert.equal(m.collectionId, "col1misfitz");
  assert.equal(m.asset.id, assetId);
  const vr = verifyManifest(m, { allowedAssets: [assetId], kind: "drip" });
  assert.equal(vr.ok, true, vr.errors.join("; "));
});
