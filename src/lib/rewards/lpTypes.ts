// MisFitz Rewards - LP dashboard DTO (CLIENT-SAFE). Plain strings/numbers; zero engine imports so the client can
// `import type` it. Money/balances are decimal base-unit STRINGS (bigint doesn't survive JSON).

import type { LeaderIdentity } from "./snapshotTypes";

export interface LpLeader extends LeaderIdentity {
  walletTrunc: string;
  lpUnits: string;      // time-weighted avg LP held this epoch (base units)
  monthsHeld: number;   // consecutive months of LP tenure
  multiplier: number;   // EFFECTIVE multiplier realized this epoch (blend across the wallet's cohorts), 1..5
  tokenUnits: string;   // $TOKEN awarded this epoch
}

export interface LpPoolDTO {
  liquidityAssetId: string;
  xchReserveMojos: string;
  tokenReserveUnits: string;
  lpSupplyUnits: string;
}

export interface LpSnapshotDTO {
  v: 1;
  colId: string;
  epoch: string;                 // "YYYY-MM"
  status: "mtd" | "final" | "pending";
  computedAt: number;
  shadow: true;
  poolLive: boolean;             // false until the $TOKEN/XCH pool is seeded on TibetSwap
  pool: LpPoolDTO | null;
  releaseUnits: string;          // this month's LP-reward release
  distributedUnits: string;      // sum actually awarded (=== release when anyone is eligible)
  holderCount: number;           // eligible LP holders this epoch
  top: LpLeader[];               // leaderboard (top N by $TOKEN awarded)
}
