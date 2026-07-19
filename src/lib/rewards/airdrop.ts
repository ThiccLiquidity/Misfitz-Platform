// MisFitz Rewards — one-time LAUNCH AIRDROP (pure, no I/O). The genesis bucket (MISFITZ_TOKEN.airdropUnits,
// 100M $SNACKZ) is split ONCE across the FINAL holder set after the collection is fully distributed —
// rarity-weighted PER NFT on the same curve the monthly drip uses (collector-first: rarer holdings get more).
// Project / mint / treasury wallets are EXCLUDED so we never airdrop to undistributed inventory or to ourselves.
// Exact bigint split (dust to the largest holder) — solvent by construction: sum(tokenUnits) === airdropUnits.
//
// Locked decisions (owner, this session): one-time 100M bucket; rarity-weighted per NFT; a fresh-scan snapshot
// FROZEN at launch; fire only AFTER Misfitz is fully distributed. Pure module — the live final-holder snapshot
// and the send are driven by the operator runbook (docs/BOT-CONTRACT.md), never automatically.

import { allocateDrip, weighHoldings, type SnapshotNft, type DripResult } from "./allocator";
import { finalizeDripManifest } from "./finalize";
import { type PayoutManifest } from "./manifest";

// Stable epoch id so the payout bot's idempotency ledger treats the genesis airdrop as ONE distinct payout —
// never re-sent, never mixed with a monthly drip epoch.
export const GENESIS_AIRDROP_EPOCH = "genesis-airdrop";

export interface AirdropInput {
  holders: SnapshotNft[];      // frozen final-distribution snapshot: one entry per HELD NFT (wallet + rank + supply)
  airdropUnits: bigint;        // total to distribute (MISFITZ_TOKEN.airdropUnits)
  excludeWallets?: string[];   // project / mint / treasury / burn wallets to omit (undistributed inventory + ours)
}

export interface AirdropResult extends DripResult {
  excludedWallets: string[];      // normalized (lowercased) exclusion set actually applied
  excludedNftCount: number;       // NFTs removed by the exclusion filter (undistributed / project-held)
  eligibleNftCount: number;       // NFTs that entered the split
  invalidWalletNftCount: number;  // NFTs whose owner wallet was empty/malformed (dropped, never allocated)
  unmatchedExcludes: string[];    // exclude entries that matched ZERO NFTs — a likely MIS-FORMED project wallet
                                  // (wrong address form/DID) that would otherwise slip through. Treat as a HALT.
}

// Pure allocation. Wallets are normalized ONCE (trim + lowercase) and that normalized form is used for BOTH the
// exclusion test AND as the recipient handed to the allocator — so "XCH1A"/"xch1a" can't split into two payees,
// and a project wallet can't dodge exclusion on case. Empty/malformed owners are dropped (never allocated).
export function buildLaunchAirdrop(input: AirdropInput): AirdropResult {
  const excludeList = (input.excludeWallets ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean);
  const exclude = new Set(excludeList);
  const excludeHits = new Map<string, number>(excludeList.map((w) => [w, 0]));
  let excludedNftCount = 0;
  let invalidWalletNftCount = 0;
  const eligibleNfts: SnapshotNft[] = [];
  for (const h of input.holders) {
    const w = (h.wallet ?? "").trim().toLowerCase();
    if (!w) { invalidWalletNftCount++; continue; }
    if (exclude.has(w)) { excludedNftCount++; excludeHits.set(w, (excludeHits.get(w) ?? 0) + 1); continue; }
    eligibleNfts.push({ wallet: w, rank: h.rank, supply: h.supply });
  }
  const unmatchedExcludes = excludeList.filter((w) => (excludeHits.get(w) ?? 0) === 0);
  // A genesis airdrop that would pay NOBODY is always an operator error (empty snapshot or an exclusion so broad
  // it removed every holder). Fail loudly rather than emit a 0-recipient manifest that reports 100M "distributed".
  if (eligibleNfts.length === 0 && input.airdropUnits > BigInt(0)) {
    throw new Error(`launch airdrop: zero eligible NFTs but airdropUnits=${input.airdropUnits} — empty snapshot or exclusion too broad`);
  }
  const result = allocateDrip(weighHoldings(eligibleNfts), input.airdropUnits);
  return { ...result, excludedWallets: [...exclude], excludedNftCount, eligibleNftCount: eligibleNfts.length, invalidWalletNftCount, unmatchedExcludes };
}

// Cut the signed, drip-kind payout manifest the bot sends. Fixed genesis epoch id → it can only pay out once.
export function finalizeAirdropManifest(
  airdrop: AirdropResult,
  tokenAssetId: string,
  sign: (hashHex: string) => string,
  collectionId: string,
): PayoutManifest {
  return finalizeDripManifest(GENESIS_AIRDROP_EPOCH, airdrop, tokenAssetId, sign, "$SNACKZ", collectionId);
}
