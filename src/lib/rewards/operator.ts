// MisFitz Rewards — operator action plan. PURE: turns an epoch result into the concrete "what do I move where"
// numbers the operator executes by hand (Traitfolio never moves funds). The one number that matters is
// `moveToHotWalletMojos`: the XCH to transfer from the (commingled) royalty wallet to the hot wallet BEFORE
// distribution, because both the reward pot ($CHIA buy) and the burn pot ($TOKEN buy&burn) are XCH->CAT swaps
// that happen there. The 1% artist cut is pure XCH profit and stays in the royalty wallet — never swapped.
//
// Invariant: moveToHotWalletMojos + keepArtistMojos === totalRoyaltyMojos (every mojo accounted for).

import { type EpochResult } from "./types";
import { type Settlement } from "./settle";

export interface OperatorPlan {
  moveToHotWalletMojos: bigint; // reward pot + burn pot — transfer this to the hot wallet, then swap
  forRewardMojos: bigint;       // portion to swap to $CHIA and distribute to holders
  forBurnMojos: bigint;         // portion to swap to $TOKEN and burn
  keepArtistMojos: bigint;      // stays in the royalty wallet (operator's 1% artist cut)
  totalRoyaltyMojos: bigint;    // = move + keep (sanity)
}

export function operatorPlan(r: EpochResult): OperatorPlan {
  return {
    moveToHotWalletMojos: r.rewardPotMojos + r.burnMojos,
    forRewardMojos: r.rewardPotMojos,
    forBurnMojos: r.burnMojos,
    keepArtistMojos: r.artistMojos,
    totalRoyaltyMojos: r.totalRoyaltyMojos,
  };
}

// The SETTLED operator plan: after unattributed rewards are routed to burn, the $CHIA buy covers only the
// VERIFIED reward pot and the burn grows by the routed amount. Same total moved to the hot wallet, correct split.
// Invariant: moveToHotWallet + keepArtist === totalRoyalty (solvent).
export function operatorPlanFromSettlement(r: EpochResult, s: Settlement): OperatorPlan {
  return {
    moveToHotWalletMojos: s.verifiedRewardPotMojos + s.adjustedBurnMojos,
    forRewardMojos: s.verifiedRewardPotMojos,
    forBurnMojos: s.adjustedBurnMojos,
    keepArtistMojos: r.artistMojos,
    totalRoyaltyMojos: r.totalRoyaltyMojos,
  };
}
