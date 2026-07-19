// MisFitz/$SNACKZ Rewards — SETTLEMENT DOCUMENT builder (PURE, no I/O). Assembles ONE labeled, hash-stamped JSON
// that the operator downloads at epoch close: exactly how much XCH to move to the fresh distribution wallet
// (broken out by purpose), how much $SNACKZ to drip from treasury, and the full per-wallet distribution table.
// Traitfolio only PUBLISHES this — it never signs or sends. The local bot consumes the manifests inside it.
//
// Money is bigint mojos / base units end to end; serialized as decimal strings so the hash is stable and there
// is never a float in the money path. Reward $CHIA amounts are intentionally NOT here: they're only known after
// the operator's one manual XCH->$CHIA swap, at which point distributeChia() splits the ACTUAL received amount.
// This document gives the pre-swap XCH-owed table + the exact buy amounts to execute.

import { createHash } from "node:crypto";
import { type EpochResult } from "./types";
import { type Settlement } from "./settle";
import { type OperatorPlan } from "./operator";
import { type DripResult } from "./allocator";
import { buildDripManifest, TOKEN_TAIL_TBD, type PayoutManifest } from "./manifest";

export interface SettlementRewardRow {
  wallet: string;
  owedMojos: string;   // total XCH owed this wallet (buyer + seller + vested bonus)
  buyerMojos: string;
  sellerMojos: string;
  bonusMojos: string;
}

export interface SettlementDoc {
  version: 1;
  collectionId: string;
  epochId: string;               // e.g. "2026-06"
  status: "mtd" | "final";       // "final" = frozen at operator close; "mtd" = running preview
  generatedAt: number;
  truncated: boolean;            // holder roster was incomplete when the drip was allocated
  // XCH to move to the FRESH distribution wallet, broken out by purpose (mojos as strings).
  move: {
    toDistributionWalletMojos: string;  // fund the distribution wallet with exactly this (reward + burn pots)
    swapToChiaForRewardsMojos: string;  //   ├─ swap this XCH -> $CHIA, then split across traders
    buyTokenForBurnMojos: string;       //   └─ swap this XCH -> $SNACKZ and burn
    artistCutMojos: string;             // stays as XCH in the royalty wallet (do NOT move/swap)
    totalRoyaltyMojos: string;          // = toDistributionWallet + artistCut (sanity; must equal epoch royalty)
  };
  // $SNACKZ drip from treasury (deterministic — no swap). manifest.asset.id is TOKEN_TAIL_TBD until $SNACKZ mints.
  drip: {
    tokenUnits: string;
    holderCount: number;
    nftCount: number;
    tokenMinted: boolean;        // false while the asset id is still the placeholder
    manifest: PayoutManifest;    // the hashed, per-wallet drip manifest the bot consumes
  };
  // Per-wallet reward distribution (pre-swap XCH owed). $CHIA per wallet is computed after the manual buy.
  rewards: {
    payoutPotMojos: string;      // verified reward pot = what the $CHIA buy must cover
    routedToBurnMojos: string;   // unattributed rewards diverted to burn (not in the table)
    droppedRecipients: number;
    wallets: SettlementRewardRow[]; // sorted desc by owed
  };
  totals: { saleCount: number; rewardRecipients: number; dripRecipients: number };
  solvent: boolean;              // epoch + settlement solvency held
  recipientListHash: string;     // sha256 over the canonical reward table + the drip manifest hash
  notes: string[];
}

function canonicalRewardRows(rows: SettlementRewardRow[]): string {
  // Stable: sort by wallet, then a fixed field order. No floats (all decimal strings).
  const sorted = [...rows].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  return sorted.map((r) => `${r.wallet}:${r.owedMojos}`).join("|");
}

export interface BuildSettlementDocInput {
  collectionId: string;
  epochId: string;
  status: "mtd" | "final";
  generatedAt: number;
  truncated: boolean;
  epochResult: EpochResult;
  settlement: Settlement;
  operator: OperatorPlan;
  drip: DripResult;
  tokenAssetId?: string;        // set once $SNACKZ is minted; defaults to the placeholder
  tokenSymbol?: string;
}

export function buildSettlementDoc(input: BuildSettlementDocInput): SettlementDoc {
  const { collectionId, epochId, status, generatedAt, truncated, epochResult, settlement, operator, drip } = input;
  const tokenAssetId = input.tokenAssetId ?? TOKEN_TAIL_TBD;
  const tokenSymbol = input.tokenSymbol ?? "$SNACKZ";

  const rewardRows: SettlementRewardRow[] = settlement.payable
    .map((p) => ({
      wallet: p.wallet,
      owedMojos: p.total.toString(),
      buyerMojos: p.buyerReward.toString(),
      sellerMojos: p.sellerReward.toString(),
      bonusMojos: p.bonus.toString(),
    }))
    .sort((a, b) => (BigInt(b.owedMojos) > BigInt(a.owedMojos) ? 1 : BigInt(b.owedMojos) < BigInt(a.owedMojos) ? -1 : 0));

  const dripManifest = buildDripManifest(epochId, drip, generatedAt, { assetId: tokenAssetId, symbol: tokenSymbol, collectionId });

  const recipientListHash = createHash("sha256")
    .update(`${collectionId}|${epochId}|${canonicalRewardRows(rewardRows)}|drip:${dripManifest.hash}`)
    .digest("hex");

  const tokenMinted = tokenAssetId !== TOKEN_TAIL_TBD;

  return {
    version: 1,
    collectionId,
    epochId,
    status,
    generatedAt,
    truncated,
    move: {
      toDistributionWalletMojos: operator.moveToHotWalletMojos.toString(),
      swapToChiaForRewardsMojos: operator.forRewardMojos.toString(),
      buyTokenForBurnMojos: operator.forBurnMojos.toString(),
      artistCutMojos: operator.keepArtistMojos.toString(),
      totalRoyaltyMojos: operator.totalRoyaltyMojos.toString(),
    },
    drip: {
      tokenUnits: drip.dripUnits.toString(),
      holderCount: drip.holderCount,
      nftCount: drip.nftCount,
      tokenMinted,
      manifest: dripManifest,
    },
    rewards: {
      payoutPotMojos: settlement.verifiedRewardPotMojos.toString(),
      routedToBurnMojos: settlement.routedToBurnMojos.toString(),
      droppedRecipients: settlement.droppedRecipients,
      wallets: rewardRows,
    },
    totals: { saleCount: epochResult.saleCount, rewardRecipients: rewardRows.length, dripRecipients: dripManifest.recipientCount },
    solvent: epochResult.solvent,
    recipientListHash,
    notes: [
      "PRE-SWAP document. Step 1: fund the fresh distribution wallet with move.toDistributionWalletMojos.",
      "Step 2: swap move.swapToChiaForRewardsMojos XCH -> $CHIA and enter the ACTUAL $CHIA received; the split absorbs slippage.",
      "Step 3: swap move.buyTokenForBurnMojos XCH -> $SNACKZ and burn. Step 4: run the drip manifest for the $SNACKZ holder drip.",
      tokenMinted ? "$SNACKZ asset id is set." : "$SNACKZ NOT minted yet — drip manifest uses a placeholder asset id and the bot will refuse to send it.",
      truncated ? "WARNING: holder roster was incomplete — drip allocation is approximate. Do not pay drips from this doc." : "Holder roster complete.",
    ],
  };
}

// Compact human-readable summary (for the dashboard / a quick eyeball before download).
export function formatSettlementDoc(d: SettlementDoc): string {
  const xch = (mojos: string) => (Number(BigInt(mojos)) / 1e12).toFixed(4);
  const L: string[] = [];
  L.push(`=== Settlement ${d.collectionId.slice(0, 10)}… epoch ${d.epochId} [${d.status}] ===`);
  L.push(`move to distribution wallet: ${xch(d.move.toDistributionWalletMojos)} XCH  (reward ${xch(d.move.swapToChiaForRewardsMojos)} + burn ${xch(d.move.buyTokenForBurnMojos)})`);
  L.push(`artist cut (keep as XCH): ${xch(d.move.artistCutMojos)} XCH`);
  L.push(`drip: ${d.drip.tokenUnits} ${d.drip.tokenMinted ? "$SNACKZ" : "$SNACKZ(placeholder)"} to ${d.drip.holderCount} holders`);
  L.push(`reward recipients: ${d.totals.rewardRecipients} · sales ${d.totals.saleCount} · solvent ${d.solvent}`);
  L.push(`recipient-list hash: ${d.recipientListHash}`);
  return L.join("\n");
}
