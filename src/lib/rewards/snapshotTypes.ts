// MisFitz Rewards — dashboard DTO (CLIENT-SAFE). Plain strings/numbers only, ZERO imports from the money engine,
// so the client component can `import type` these without pulling any reward logic into the browser bundle. All
// money is a decimal STRING (base units) — bigint doesn't survive JSON. Serializers live in snapshotSerialize.ts.
//
// The PUBLIC snapshot omits the operator ACTION panel (the "move X to the hot wallet" instruction), served by the
// authed /api/rewards/operator route. NOTE: the royalty totals (reward pot / burn / artist) ARE public dashboard
// stats, so the move amount is derivable from them — what's operator-only is the phrased instruction, not the
// on-chain-public royalty figures.

// Resolved public identity for a leaderboard wallet. name/avatarUrl are null for wallets with no MintGarden
// profile OR wallets that opted out — the UI then shows the truncated address alone.
export interface LeaderIdentity {
  name: string | null;
  avatarUrl: string | null;
}

export interface TraderLeader extends LeaderIdentity {
  walletTrunc: string;
  buyer: string;
  seller: string;
  bonus: string;
  total: string;        // total XCH rewards (mojos) this wallet earned — the $CHIA leaderboard sort key
}

export interface HolderLeader extends LeaderIdentity {
  walletTrunc: string;
  nftCount: number;
  weight: number;
  tokenUnits: string;   // monthly $TOKEN drip — the $TOKEN leaderboard sort key
}

export interface TraderDTO {
  saleCount: number;
  totalRoyaltyMojos: string;
  rewardPotMojos: string;   // VERIFIED reward pot (after unattributed routed to burn)
  burnMojos: string;        // adjusted burn (includes routed unattributed + voided bonuses)
  artistMojos: string;
  payoutCount: number;
  topPayouts: TraderLeader[];
  bonuses: { paid: number; voided: number };
}

export interface DripDTO {
  dripUnits: string;
  holderCount: number;
  nftCount: number;
  topHolders: HolderLeader[];
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
  meta: { assumes10pctRoyalty: true; unattributedCount: number; truncated: boolean };
}

// Operator-only payload (served by the authed /api/rewards/operator route; NEVER part of the public snapshot).
export interface OperatorSnapshotDTO {
  v: 1;
  colId: string;
  epoch: string;
  status: "mtd" | "final";
  computedAt: number;
  operator: OperatorDTO;
}

// Per-wallet lookup value (kept OUT of the public snapshot; served by /api/rewards/lookup).
export interface WalletLookupValue { tokenUnits: string; traderTotalMojos: string; nftCount: number }

// Truncate a wallet/DID for the public leaderboard: xch1abcd…wxyz (exact figures require the lookup).
export function truncWallet(w: string): string {
  if (w.length <= 16) return w;
  return `${w.slice(0, 8)}…${w.slice(-4)}`;
}
