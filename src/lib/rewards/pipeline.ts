// MisFitz Rewards — REAL monthly epoch pipeline (LIVE, keyless). Assembles the built pieces into the actual flow
// the operator runs: detect sales -> FREEZE the deal tag -> VERIFY royalty on-chain -> settle unattributed ->
// operator plan. The operator then buys $CHIA and calls finalize.ts to build + sign the manifest for the bot.
// Imports the data layer + the operator's RoyaltyChainProvider; holds no keys, moves no funds. Not unit-tested
// (network) — the pure finalizers (finalize.ts) and every piece this chains ARE tested. server-only guard below.
if (typeof window !== "undefined") throw new Error("pipeline is server-only");

import { fetchDexieEpochSales, resolveFvLookup, fetchActiveListings } from "./detectLive";
import { buildEpochInputs } from "./detect";
import { verifySales, assertVerifiedSales, type ChainVerifyConfig } from "./chainVerify";
import { type RoyaltyChainProvider } from "./chainProvider";
import { computeEpoch } from "./engine";
import { settleUnattributed, assertSettlementSolvent } from "./settle";
import { operatorPlanFromSettlement } from "./operator";
import { DEFAULT_CONFIG, type RewardConfig } from "./types";
import { type PreparedEpoch } from "./finalize";

// Detect -> freeze -> verify -> settle -> operator plan. Only royalty-verified sales fund the epoch; their
// buyer/seller/royalty come from chain (authoritative). Returns everything finalize.ts needs after the buy.
export async function prepareRewardEpoch(
  colId: string,
  window: { epochStart: number; epochEnd: number; epochId: string },
  provider: RoyaltyChainProvider,
  verifyCfg: ChainVerifyConfig,
  cfg: RewardConfig = DEFAULT_CONFIG,
): Promise<PreparedEpoch> {
  const raws = await fetchDexieEpochSales(colId, window.epochStart, window.epochEnd);
  // Freeze the deal tag (persist) + read active listings for the vest-void signals. Attribution comes from the
  // CHAIN via verifySales, so MintGarden attribution isn't needed here.
  const [fv, listings] = await Promise.all([resolveFvLookup(colId, raws, { persist: true }), fetchActiveListings(colId)]);
  const { sales, signals } = buildEpochInputs(raws, window.epochStart, window.epochEnd, fv.fvOf, listings);

  const partition = await verifySales(sales, provider, verifyCfg);
  assertVerifiedSales(partition.verified);

  const payoutAt = Math.max(Date.now(), window.epochEnd);
  const epochResult = computeEpoch(partition.verified, signals, window.epochStart, window.epochEnd, cfg, payoutAt);
  const settlement = settleUnattributed(epochResult);
  assertSettlementSolvent(epochResult, settlement);
  const operator = operatorPlanFromSettlement(epochResult, settlement);

  return {
    epochId: window.epochId,
    epochResult,
    settlement,
    operator,
    verifiedCount: partition.verified.length,
    retriedCount: partition.retry.length,
    rejected: partition.rejected.map((r) => ({ saleId: r.sale.id, nftId: r.sale.nftId, reason: r.reason })),
  };
}
