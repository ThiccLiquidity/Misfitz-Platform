import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch, distributeChia } from "../../src/lib/rewards/engine";
import { settleUnattributed, isUnattributed, assertSettlementSolvent } from "../../src/lib/rewards/settle";
import { buildRewardManifest, buildDripManifest, hashManifest, signManifest, CHIA_ASSET_ID, TOKEN_TAIL_TBD, type PayoutManifest } from "../../src/lib/rewards/manifest";
import { verifyManifest, pendingRecipients, markExecuted, paymentKey } from "../../src/lib/rewards/manifestGuard";
import { allocateDrip } from "../../src/lib/rewards/allocator";
import { toSale, type RawSale } from "../../src/lib/rewards/detect";

const raw = (o: Partial<RawSale> & { offerId: string; nftId: string; priceXch: number; soldAt: number }): RawSale => o;
const A = (c: string) => "xch1" + c.repeat(58); // valid-FORMAT Chia address for tests
const ALICE = A("a"), BOB = A("b");

// One ATTRIBUTED sale (ALICE/BOB) + one UNATTRIBUTED (placeholders).
function epoch() {
  const sales = [
    toSale(raw({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: ALICE, seller: BOB }), null),
    toSale(raw({ offerId: "s2", nftId: "n2", priceXch: 60, soldAt: 2 }), null), // unknown-*:s2
  ];
  return computeEpoch(sales, [], 0, 10);
}

test("settleUnattributed: unknown-* routes to burn; solvency preserved; assert passes", () => {
  const r = epoch();
  const s = settleUnattributed(r);
  assert.ok(s.payable.every((p) => !isUnattributed(p.wallet)));
  assert.ok(s.routedToBurnMojos > BigInt(0));
  assert.equal(r.artistMojos + s.adjustedBurnMojos + s.verifiedRewardPotMojos, r.totalRoyaltyMojos);
  assert.doesNotThrow(() => assertSettlementSolvent(r, s));
});

test("buildRewardManifest throws on mis-wiring (unattributed / non-payable $CHIA keys)", () => {
  const r = epoch();
  const s = settleUnattributed(r);
  // Passing the UNSETTLED payouts (contain unknown-*) must throw, not silently strand funds.
  const badMap = new Map(r.payouts.map((p) => [p.wallet, BigInt(1)]));
  assert.throws(() => buildRewardManifest("e", s.payable, badMap, 1), /unattributed|not in the settled/);
});

test("reward manifest: verified-only recipients; hash stable + tamper-evident; verify OK", () => {
  const r = epoch();
  const s = settleUnattributed(r);
  const chia = distributeChia(s.payable, s.verifiedRewardPotMojos, BigInt(1_000_000));
  const m = buildRewardManifest("2026-06", s.payable, chia, 1_700_000_000_000, s.routedToBurnMojos);
  assert.ok(m.recipients.length > 0 && m.recipients.every((x) => !x.wallet.startsWith("unknown-")));
  const { hash, ...body } = m; assert.equal(hashManifest(body), hash); void hash;
  // reward requires a funding cap
  assert.equal(verifyManifest(m, { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: BigInt(1_000_000) }).ok, true);
  assert.equal(verifyManifest(m, { allowedAssets: [CHIA_ASSET_ID] }).ok, false, "missing funding cap -> fail");
  assert.equal(verifyManifest(m, { allowedAssets: ["other"], fundingCapUnits: BigInt(1_000_000) }).ok, false, "wrong asset -> fail");
  assert.equal(verifyManifest(m, { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: BigInt(1) }).ok, false, "cap too low -> fail");
  const tampered: PayoutManifest = { ...m, totalUnits: (BigInt(m.totalUnits) + BigInt(1)).toString() };
  assert.equal(verifyManifest(tampered, { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: BigInt(1_000_000) }).ok, false, "tamper -> hash fail");
});

test("verify: signature required when a verifier is supplied; invalid signature fails", () => {
  const d = allocateDrip([{ wallet: A("c"), weight: 1 }], BigInt(100));
  const m = buildDripManifest("2026-06", d, 1, { assetId: "TAILX" });
  const good = signManifest(m, (h) => "sig:" + h);
  const verify = (h: string, sig: string) => sig === "sig:" + h;
  assert.equal(verifyManifest(m, { allowedAssets: ["TAILX"], verifySignature: verify }).ok, false, "no signature -> fail");
  assert.equal(verifyManifest(good, { allowedAssets: ["TAILX"], verifySignature: verify }).ok, true, "valid signature -> ok");
  assert.equal(verifyManifest({ ...good, signature: "sig:bogus" }, { allowedAssets: ["TAILX"], verifySignature: verify }).ok, false);
});

test("verify: placeholder tail is rejected for real sends; wallet allowlist blocks garbage", () => {
  const d1 = allocateDrip([{ wallet: A("c"), weight: 1 }], BigInt(100));
  const placeholder = buildDripManifest("2026-06", d1, 1); // asset defaults to TOKEN_TAIL_TBD
  assert.equal(verifyManifest(placeholder, { allowedAssets: [TOKEN_TAIL_TBD] }).ok, false, "placeholder tail -> fail");
  assert.equal(verifyManifest(placeholder, { allowedAssets: [TOKEN_TAIL_TBD], allowPlaceholderAsset: true }).ok, true, "shadow preview -> ok");
  const d2 = allocateDrip([{ wallet: "not-an-address", weight: 1 }], BigInt(100));
  const badWallet = buildDripManifest("2026-06", d2, 1, { assetId: "TAILX" });
  assert.equal(verifyManifest(badWallet, { allowedAssets: ["TAILX"] }).ok, false, "invalid wallet -> fail");
});

test("idempotency ledger is amount-aware: skip equal, CONFLICT on changed amount (no silent underpay)", () => {
  const d = allocateDrip([{ wallet: "a", weight: 1 }, { wallet: "b", weight: 1 }, { wallet: "c", weight: 1 }], BigInt(300));
  const m = buildDripManifest("2026-07", d, 1, { assetId: "TAILX" });
  const ledger = new Map<string, string>();
  assert.equal(pendingRecipients(m, ledger).pending.length, 3);
  markExecuted(m, ledger, [m.recipients[0]]);
  assert.equal(pendingRecipients(m, ledger).pending.length, 2);
  markExecuted(m, ledger, [m.recipients[0]]); // idempotent
  assert.equal(pendingRecipients(m, ledger).pending.length, 2);
  // same recipient, DIFFERENT amount -> conflict, not a silent skip
  const changed: PayoutManifest = { ...m, recipients: m.recipients.map((r, i) => (i === 0 ? { ...r, amountUnits: (BigInt(r.amountUnits) + BigInt(1)).toString() } : r)) };
  const res = pendingRecipients(changed, ledger);
  assert.equal(res.conflicts.length, 1);
  assert.equal(res.conflicts[0].paidAmount, m.recipients[0].amountUnits);
  // key is injection-safe (JSON-encoded) even with a DID-style wallet containing ':'
  assert.equal(paymentKey(m, m.recipients[0]).includes("["), true);
});
