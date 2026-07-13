import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeRewardManifest, finalizeDripManifest, type PreparedEpoch } from "../../src/lib/rewards/finalize";
import { computeEpoch } from "../../src/lib/rewards/engine";
import { settleUnattributed } from "../../src/lib/rewards/settle";
import { operatorPlan } from "../../src/lib/rewards/operator";
import { toSale, type RawSale } from "../../src/lib/rewards/detect";
import { allocateDrip } from "../../src/lib/rewards/allocator";
import { verifyManifest } from "../../src/lib/rewards/manifestGuard";
import { CHIA_ASSET_ID } from "../../src/lib/rewards/manifest";

const A = (c: string) => "xch1" + c.repeat(58);
const sign = (h: string) => "sig:" + h;
const verifySig = (h: string, s: string) => s === "sig:" + h;

function prepared(): PreparedEpoch {
  const epochResult = computeEpoch([toSale({ offerId: "s1", nftId: "n1", priceXch: 100, soldAt: 1, buyer: A("a"), seller: A("b") } as RawSale, null)], [], 0, 10);
  const settlement = settleUnattributed(epochResult);
  return { epochId: "2026-06", epochResult, settlement, operator: operatorPlan(epochResult), verifiedCount: 1, retriedCount: 0, rejected: [] };
}

test("finalizeRewardManifest: signed + chain-verified, passes the bot's guard", () => {
  const m = finalizeRewardManifest(prepared(), BigInt(1_000_000), sign);
  assert.equal(m.provenance, "chain-verified");
  assert.ok(m.signature, "signed");
  const vr = verifyManifest(m, { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: BigInt(1_000_000), verifySignature: verifySig });
  assert.equal(vr.ok, true, vr.errors.join("; "));
  // an unsigned recompute of the same body must match the sealed hash (provenance is inside the hash)
});

test("finalizeDripManifest: signed drip manifest verifies", () => {
  const drip = allocateDrip([{ wallet: A("a"), weight: 1 }, { wallet: A("b"), weight: 1 }], BigInt(40_000_000_000));
  const m = finalizeDripManifest("2026-06", drip, "TAILX", sign);
  assert.ok(m.signature);
  const vr = verifyManifest(m, { allowedAssets: ["TAILX"], verifySignature: verifySig });
  assert.equal(vr.ok, true, vr.errors.join("; "));
});

test("finalizeRewardManifest refuses an epoch with retry sales still pending finality (F1)", () => {
  const p: PreparedEpoch = { ...prepared(), retriedCount: 1 };
  assert.throws(() => finalizeRewardManifest(p, BigInt(1_000_000), sign), /awaiting finality/);
});
