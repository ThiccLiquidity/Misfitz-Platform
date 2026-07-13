// MisFitz Rewards — $TOKEN drip ALLOCATOR (pure). Given a monthly holder snapshot and the month's drip amount
// (in smallest $TOKEN units), returns how much each wallet gets. Rarity-weighted PER NFT: every held NFT earns
// a base share plus a rarity premium from the SAME curve the site values NFTs with, so rarer holdings drip
// more (collector-first). Exact integer math (dust to the largest holder) — solvent by construction:
//   sum(wallet.tokenUnits) === dripUnits  (whenever dripUnits > 0 and any weighted holdings exist).
//
// Operator decisions (MISFITZ-REWARDS.md): rarity-weighted per NFT; snapshot on a FIXED date (1st of month);
// LISTED NFTs still count (an NFT you still own earns its drip). This module is pure — the live holder snapshot
// (who owns what on the 1st) is assembled in allocatorLive.ts. Imported by nothing in the live app.

import { rarityFactorForPercentile } from "@/lib/valuation/estimate";

const SHARE_SCALE = 1_000_000; // weight (float) -> integer micro-shares, for an EXACT bigint proportional split

// Per-NFT weight from its rank: base 1 (every holder shares) + the rarity premium from the valuation curve, so
// a grail drips several× a floor piece while a common still earns its base share. rank in 1..supply; unknown
// rank/supply falls back to the base weight of 1 (still earns, just no rarity bump).
export function rarityWeight(rank: number | null | undefined, supply: number | null | undefined): number {
  if (!rank || !supply || rank <= 0 || supply <= 0) return 1;
  const pct = Math.max(0.0001, Math.min(100, (rank / supply) * 100));
  return 1 + rarityFactorForPercentile(pct);
}

export interface SnapshotNft { wallet: string; rank?: number | null; supply?: number | null }

// Attach the rarity weight to each snapshot NFT (convenience for callers that have rank+supply).
export function weighHoldings(nfts: SnapshotNft[]): { wallet: string; weight: number }[] {
  return nfts.map((n) => ({ wallet: n.wallet, weight: rarityWeight(n.rank, n.supply) }));
}

export interface WalletDrip {
  wallet: string;
  nftCount: number;   // how many NFTs this wallet held at snapshot
  weight: number;     // summed rarity weight across those NFTs
  tokenUnits: bigint; // $TOKEN allocated this epoch
}

export interface DripResult {
  dripUnits: bigint;   // total $TOKEN distributed this epoch (= sum of wallet allocations when solvent)
  holderCount: number;
  nftCount: number;
  wallets: WalletDrip[]; // sorted desc by tokenUnits
  solvent: boolean;      // sum(tokenUnits) === dripUnits (or dripUnits<=0 / no holders -> trivially true)
}

export function allocateDrip(holdings: { wallet: string; weight: number }[], dripUnits: bigint): DripResult {
  const byWallet = new Map<string, { nfts: number; shares: bigint }>();
  let totalShares = BigInt(0);
  let nftCount = 0;
  for (const h of holdings) {
    const shares = BigInt(Math.max(0, Math.round(h.weight * SHARE_SCALE)));
    const w = byWallet.get(h.wallet) ?? { nfts: 0, shares: BigInt(0) };
    w.nfts += 1;
    w.shares += shares;
    byWallet.set(h.wallet, w);
    totalShares += shares;
    nftCount += 1;
  }

  const Z = BigInt(0);
  const wallets: WalletDrip[] = [];

  if (dripUnits <= Z || totalShares <= Z) {
    for (const [wallet, w] of byWallet) wallets.push({ wallet, nftCount: w.nfts, weight: Number(w.shares) / SHARE_SCALE, tokenUnits: Z });
    wallets.sort((a, b) => b.nftCount - a.nftCount);
    return { dripUnits: dripUnits > Z ? dripUnits : Z, holderCount: byWallet.size, nftCount, wallets, solvent: true };
  }

  let allocated = Z;
  let largestWallet: string | null = null;
  let largestShares = BigInt(-1);
  for (const [wallet, w] of byWallet) {
    const tokenUnits = (dripUnits * w.shares) / totalShares; // floor
    wallets.push({ wallet, nftCount: w.nfts, weight: Number(w.shares) / SHARE_SCALE, tokenUnits });
    allocated += tokenUnits;
    if (w.shares > largestShares) { largestShares = w.shares; largestWallet = wallet; }
  }
  // Integer-division dust -> the largest holder, so the total distributed equals dripUnits EXACTLY.
  const dust = dripUnits - allocated;
  if (dust > Z && largestWallet) { const wd = wallets.find((x) => x.wallet === largestWallet)!; wd.tokenUnits += dust; }

  wallets.sort((a, b) => (b.tokenUnits > a.tokenUnits ? 1 : b.tokenUnits < a.tokenUnits ? -1 : 0));
  const sum = wallets.reduce((s, w) => s + w.tokenUnits, Z);
  return { dripUnits, holderCount: byWallet.size, nftCount, wallets, solvent: sum === dripUnits };
}
