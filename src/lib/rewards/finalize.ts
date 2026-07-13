// MisFitz Rewards — REAL-epoch finalizers (PURE). Assemble a signed, chain-verified payout manifest from a
// prepared epoch. Kept pure (no I/O) so the money-critical assembly is unit-tested; the live detect+verify
// preparation lives in pipeline.ts. Reward $CHIA amounts are only known AFTER the operator's monthly buy, so
// finalizeRewardManifest takes the actual $CHIA received and shares it proportionally (distributeChia).

import { distributeChia } from "./engine";
import { buildRewardManifest, buildDripManifest, signManifest, CHIA_ASSET_ID, type PayoutManifest } from "./manifest";
import { type EpochResult } from "./types";
import { type Settlement } from "./settle";
import { type OperatorPlan } from "./operator";
import { type DripResult } from "./allocator";

// The output of the detect+verify+settle preparation (see pipeline.prepareRewardEpoch). Everything downstream
// needs is here; the reward manifest is finalized once the operator reports the $CHIA they bought.
export interface PreparedEpoch {
  epochId: string;
  epochResult: EpochResult;
  settlement: Settlement;
  operator: OperatorPlan;
  verifiedCount: number;
  retriedCount: number;
  rejected: { saleId: string; nftId: string; reason: string }[];
}

// After the operator buys $CHIA with the reward pot and reports the ACTUAL units received: split it across the
// verified payees, build a CHAIN-VERIFIED reward manifest, and sign it. The bot refuses anything not both.
export function finalizeRewardManifest(
  prepared: PreparedEpoch,
  chiaReceivedUnits: bigint,
  sign: (hashHex: string) => string,
  chiaAssetId: string = CHIA_ASSET_ID,
): PayoutManifest {
  // Retry sales (awaiting block depth) are excluded from computeEpoch and do NOT roll to the next epoch's fetch
  // window — re-run prepareRewardEpoch until retry drains before finalizing, else those buyers/sellers are lost.
  if (prepared.retriedCount > 0) throw new Error(`epoch ${prepared.epochId}: ${prepared.retriedCount} sale(s) awaiting finality — re-run until retry is empty before finalizing`);
  const chiaPerWallet = distributeChia(prepared.settlement.payable, prepared.settlement.verifiedRewardPotMojos, chiaReceivedUnits);
  const m = buildRewardManifest(
    prepared.epochId,
    prepared.settlement.payable,
    chiaPerWallet,
    Date.now(),
    prepared.settlement.routedToBurnMojos,
    chiaAssetId,
    "chain-verified",
  );
  return signManifest(m, sign);
}

// The $TOKEN drip manifest is fully deterministic (no buy) — build from the holder allocation and sign.
export function finalizeDripManifest(
  epochId: string,
  drip: DripResult,
  tokenAssetId: string,
  sign: (hashHex: string) => string,
  symbol = "$TOKEN",
): PayoutManifest {
  const m = buildDripManifest(epochId, drip, Date.now(), { symbol, assetId: tokenAssetId });
  return signManifest(m, sign);
}
