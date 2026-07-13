// MisFitz Rewards — unattributed-reward settlement (PURE). Operator decision: a reward whose wallet could not
// be verified (an `unknown-*` placeholder from detection) is NEVER paid to that placeholder — its XCH is routed
// to the BURN instead. This runs BETWEEN computeEpoch and the $CHIA buy: the $CHIA purchase then covers only
// verified wallets, and the unattributed XCH joins the burn pot. Solvency is preserved exactly:
//   verifiedRewardPot + adjustedBurn + artist === original totalRoyalty.

import { type EpochResult, type WalletPayout } from "./types";

export function isUnattributed(wallet: string): boolean {
  return wallet.startsWith("unknown-buyer:") || wallet.startsWith("unknown-seller:");
}

export interface Settlement {
  payable: WalletPayout[];        // verified wallets only (these get $CHIA)
  verifiedRewardPotMojos: bigint; // sum of payable.total — what the monthly $CHIA buy should cover
  routedToBurnMojos: bigint;      // unattributed rewards diverted to the burn
  adjustedBurnMojos: bigint;      // original burn + routedToBurn (what actually gets bought-&-burned)
  droppedRecipients: number;      // how many placeholder lines were routed away
}

export function settleUnattributed(r: EpochResult): Settlement {
  const Z = BigInt(0);
  const payable: WalletPayout[] = [];
  let verified = Z;
  let routed = Z;
  let dropped = 0;
  for (const p of r.payouts) {
    if (isUnattributed(p.wallet)) { routed += p.total; dropped += 1; }
    else { payable.push(p); verified += p.total; }
  }
  return {
    payable,
    verifiedRewardPotMojos: verified,
    routedToBurnMojos: routed,
    adjustedBurnMojos: r.burnMojos + routed,
    droppedRecipients: dropped,
  };
}

// Runtime guard: the routing must preserve solvency exactly. Call after settleUnattributed on the money path so
// a future engine/settle change can't silently break the invariant (tests check it too, this checks production).
export function assertSettlementSolvent(r: EpochResult, s: Settlement): void {
  const lhs = r.artistMojos + s.adjustedBurnMojos + s.verifiedRewardPotMojos;
  if (lhs !== r.totalRoyaltyMojos) {
    throw new Error(`settlement not solvent: artist+burn+verifiedPot ${lhs} != royalty ${r.totalRoyaltyMojos}`);
  }
}
