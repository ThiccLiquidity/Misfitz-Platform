// MisFitz Rewards — FROZEN airdrop snapshot. The genesis airdrop must run against an IMMUTABLE holder list:
// a fresh full scan taken at launch, hashed, and pinned so the preview, the manifest, and the send all use the
// exact same roster (a re-scan would drift as NFTs trade). The hash ties into the bot's `--expect-hash` /
// epoch-sentinel guards so the one-time airdrop can't be silently re-cut against a different snapshot.

import { createHash } from "node:crypto";
import type { SnapshotNft } from "./allocator";

export interface FrozenAirdropSnapshot {
  version: 1;
  collectionId: string;
  capturedAt: number;      // ms epoch when scanned
  holderNftCount: number;  // total held NFTs (one row per NFT with an owner)
  hash: string;            // sha256 over the canonical holder rows — integrity + immutability anchor
  holders: SnapshotNft[];  // frozen: {wallet (normalized), rank, supply} per held NFT
}

// Deterministic canonical form: normalize wallet, drop to [wallet, rank, supply], sort — so the SAME holder set
// always hashes identically regardless of scan order.
function canonical(holders: SnapshotNft[]): string {
  // Serialize each row, then sort the STRINGS — a total order that can't tie null vs 0 (which JSON renders
  // differently), so the same holder multiset always hashes identically regardless of scan order.
  const rows = holders.map((h) => JSON.stringify([ (h.wallet ?? "").trim().toLowerCase(), h.rank ?? null, h.supply ?? null ]));
  rows.sort();
  return JSON.stringify(rows);
}

export function hashHolders(holders: SnapshotNft[]): string {
  return createHash("sha256").update(canonical(holders)).digest("hex");
}

// Freeze a fresh scan into an immutable, hashed snapshot (wallets normalized to match buildLaunchAirdrop).
export function freezeAirdropSnapshot(collectionId: string, holders: SnapshotNft[]): FrozenAirdropSnapshot {
  const norm = holders.map((h) => ({ wallet: (h.wallet ?? "").trim().toLowerCase(), rank: h.rank ?? null, supply: h.supply ?? null }));
  return { version: 1, collectionId, capturedAt: Date.now(), holderNftCount: norm.length, hash: hashHolders(norm), holders: norm };
}

// True iff the snapshot is well-formed AND its holders still hash to the stored hash (tamper / corruption check).
export function verifyFrozenSnapshot(snap: FrozenAirdropSnapshot | null | undefined): boolean {
  return !!snap && snap.version === 1 && Array.isArray(snap.holders)
    && typeof snap.collectionId === "string" && snap.collectionId.length > 0
    && snap.holderNftCount === snap.holders.length
    && hashHolders(snap.holders) === snap.hash;
}
