// MisFitz Rewards — dashboard DTO (CLIENT-SAFE). Plain strings/numbers only, ZERO imports from the money engine,
// so the client component can `import type` these without pulling any reward logic into the browser bundle. All
// money is a decimal STRING (base units) — bigint doesn't survive JSON. Serializers live in snapshotSerialize.ts.

export interface TraderDTO {
  saleCount: number;
  totalRoyaltyMojos: string;
  rewardPotMojos: string;   // VERIFIED reward pot (after unattributed routed to burn)
  burnMojos: string;        // adjusted burn (includes routed unattributed + voided bonuses)
  artistMojos: string;
  payoutCount: number;
  topPayouts: { walletTrunc: string; buyer: string; seller: string; bonus: string; total: string }[];
  bonuses: { paid: number; voided: number };
}

export interface DripDTO {
  dripUnits: string;
  holderCount: number;
  nftCount: number;
  topHolders: { walletTrunc: string; nftCount: number; weight: number; tokenUnits: string }[];
}

export interface OperatorDTO {
  moveToHotWalletMojos: string;
  forRewardMojos: string;
  forBurnMojos: string;
  keepArtistMojos: string;
}

export interface SnapshotDTO {
  v: 1;
  colId: string;
  epoch: string;                       // "YYYY-MM"
  status: "mtd" | "final" | "pending";
  computedAt: number;                  // ms epoch
  shadow: true;
  trader: TraderDTO;
  drip: DripDTO;
  operator: OperatorDTO;
  meta: { assumes10pctRoyalty: true; unattributedCount: number; truncated: boolean };
}

// Per-wallet lookup value (kept OUT of the public snapshot; served by /api/rewards/lookup).
export interface WalletLookupValue { tokenUnits: string; traderTotalMojos: string; nftCount: number }

// Truncate a wallet/DID for the public leaderboard: xch1abcd…wxyz (exact figures require the lookup).
export function truncWallet(w: string): string {
  if (w.length <= 16) return w;
  return `${w.slice(0, 8)}…${w.slice(-4)}`;
}
