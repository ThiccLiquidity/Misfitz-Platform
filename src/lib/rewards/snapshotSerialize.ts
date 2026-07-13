// MisFitz Rewards — pure serializers: engine results -> client-safe DTO (base-unit STRINGS). No I/O, no network;
// unit-tested. Uses the SETTLED figures (verified reward pot, adjusted burn) so the dashboard shows what actually
// pays out vs burns. Truncated leaderboard only; the full per-wallet map is built separately for the lookup API.

import { type EpochResult } from "./types";
import { type Settlement } from "./settle";
import { type OperatorPlan } from "./operator";
import { type DripResult } from "./allocator";
import { truncWallet, type SnapshotDTO, type WalletLookupValue } from "./snapshotTypes";

export function toSnapshotDTO(args: {
  colId: string;
  epoch: string;
  status: "mtd" | "final";
  computedAt: number;
  epochResult: EpochResult;
  settlement: Settlement;
  operator: OperatorPlan;
  drip: DripResult;
  truncated: boolean;
}): SnapshotDTO {
  const { epochResult: e, settlement: s, operator: op, drip: d } = args;
  const payouts = [...s.payable].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0)).slice(0, 25);
  return {
    v: 1,
    colId: args.colId,
    epoch: args.epoch,
    status: args.status,
    computedAt: args.computedAt,
    shadow: true,
    trader: {
      saleCount: e.saleCount,
      totalRoyaltyMojos: e.totalRoyaltyMojos.toString(),
      rewardPotMojos: s.verifiedRewardPotMojos.toString(),
      burnMojos: s.adjustedBurnMojos.toString(),
      artistMojos: e.artistMojos.toString(),
      payoutCount: s.payable.length,
      topPayouts: payouts.map((p) => ({
        walletTrunc: truncWallet(p.wallet),
        buyer: p.buyerReward.toString(),
        seller: p.sellerReward.toString(),
        bonus: p.bonus.toString(),
        total: p.total.toString(),
      })),
      bonuses: {
        paid: e.bonuses.filter((b) => b.status === "paid").length,
        voided: e.bonuses.filter((b) => b.status === "voided").length,
      },
    },
    drip: {
      dripUnits: d.dripUnits.toString(),
      holderCount: d.holderCount,
      nftCount: d.nftCount,
      topHolders: d.wallets.slice(0, 25).map((w) => ({
        walletTrunc: truncWallet(w.wallet),
        nftCount: w.nftCount,
        weight: w.weight,
        tokenUnits: w.tokenUnits.toString(),
      })),
    },
    operator: {
      moveToHotWalletMojos: op.moveToHotWalletMojos.toString(),
      forRewardMojos: op.forRewardMojos.toString(),
      forBurnMojos: op.forBurnMojos.toString(),
      keepArtistMojos: op.keepArtistMojos.toString(),
    },
    meta: { assumes10pctRoyalty: true, unattributedCount: s.droppedRecipients, truncated: args.truncated },
  };
}

// Full per-wallet lookup map (served privately, NOT in the public snapshot). Combines each wallet's drip tokens
// and their trader reward XCH for this epoch.
export function buildWalletMap(drip: DripResult, settlement: Settlement): Record<string, WalletLookupValue> {
  const out: Record<string, WalletLookupValue> = {};
  for (const w of drip.wallets) out[w.wallet] = { tokenUnits: w.tokenUnits.toString(), traderTotalMojos: "0", nftCount: w.nftCount };
  for (const p of settlement.payable) {
    const cur = out[p.wallet] ?? { tokenUnits: "0", traderTotalMojos: "0", nftCount: 0 };
    cur.traderTotalMojos = (BigInt(cur.traderTotalMojos) + p.total).toString();
    out[p.wallet] = cur;
  }
  return out;
}
