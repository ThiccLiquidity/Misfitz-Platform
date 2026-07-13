// MisFitz Rewards — pure serializers: engine results -> client-safe DTO (base-unit STRINGS). No I/O, no network;
// unit-tested. Uses the SETTLED figures (verified reward pot, adjusted burn) so the dashboard shows what actually
// pays out vs burns. Truncated leaderboard only; the full per-wallet map is built separately for the lookup API.
//
// Operator actions are serialized SEPARATELY (toOperatorDTO) and NEVER included in the public snapshot.

import { type EpochResult } from "./types";
import { type Settlement } from "./settle";
import { type OperatorPlan } from "./operator";
import { type DripResult } from "./allocator";
import { truncWallet, type SnapshotDTO, type OperatorSnapshotDTO, type LeaderIdentity, type WalletLookupValue } from "./snapshotTypes";

export const LEADER_N = 10; // leaderboard depth (top N per board)

// Resolved public identity per FULL wallet. Missing wallet / null fields => the UI shows the truncated address.
export type ProfileMap = Map<string, LeaderIdentity>;
const identityFor = (profiles: ProfileMap | undefined, wallet: string): LeaderIdentity =>
  profiles?.get(wallet) ?? { name: null, avatarUrl: null };

const byTotalDesc = <T extends { total: bigint }>(a: T, b: T) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0);
const byTokensDesc = <T extends { tokenUnits: bigint }>(a: T, b: T) => (b.tokenUnits > a.tokenUnits ? 1 : b.tokenUnits < a.tokenUnits ? -1 : 0);

// PURE selection of the wallets that will appear on each leaderboard — so the job can resolve identities for
// exactly those (a couple dozen), never the whole holder set. Same ordering the DTO uses.
export function leaderboardWallets(settlement: Settlement, drip: DripResult, n: number = LEADER_N): { traders: string[]; holders: string[] } {
  const traders = [...settlement.payable].sort(byTotalDesc).slice(0, n).map((p) => p.wallet);
  const holders = [...drip.wallets].sort(byTokensDesc).slice(0, n).map((w) => w.wallet);
  return { traders, holders };
}

export function toSnapshotDTO(args: {
  colId: string;
  epoch: string;
  status: "mtd" | "final";
  computedAt: number;
  epochResult: EpochResult;
  settlement: Settlement;
  drip: DripResult;
  truncated: boolean;
  profiles?: ProfileMap;
}): SnapshotDTO {
  const { epochResult: e, settlement: s, drip: d, profiles } = args;
  const payouts = [...s.payable].sort(byTotalDesc).slice(0, LEADER_N);
  const holders = [...d.wallets].sort(byTokensDesc).slice(0, LEADER_N);
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
        ...identityFor(profiles, p.wallet),
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
      topHolders: holders.map((w) => ({
        walletTrunc: truncWallet(w.wallet),
        ...identityFor(profiles, w.wallet),
        nftCount: w.nftCount,
        weight: w.weight,
        tokenUnits: w.tokenUnits.toString(),
      })),
    },
    meta: { assumes10pctRoyalty: true, unattributedCount: s.droppedRecipients, truncated: args.truncated },
  };
}

// Operator-only serializer — the counterpart the authed operator route serves. Kept out of the public snapshot.
export function toOperatorDTO(args: {
  colId: string;
  epoch: string;
  status: "mtd" | "final";
  computedAt: number;
  operator: OperatorPlan;
}): OperatorSnapshotDTO {
  const op = args.operator;
  return {
    v: 1,
    colId: args.colId,
    epoch: args.epoch,
    status: args.status,
    computedAt: args.computedAt,
    operator: {
      moveToHotWalletMojos: op.moveToHotWalletMojos.toString(),
      forRewardMojos: op.forRewardMojos.toString(),
      forBurnMojos: op.forBurnMojos.toString(),
      keepArtistMojos: op.keepArtistMojos.toString(),
    },
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
