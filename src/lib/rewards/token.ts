// MisFitz Rewards — $TOKEN supply model (PURE). Fixed 1,000,000,000 supply split into buckets, a monthly
// GEOMETRIC drip (5% of the REMAINING drip pool), and buy-&-burn accounting. All amounts are bigint BASE UNITS
// (Chia CAT = 3 decimals, so 1 token = 1000 base units) — no floats on the supply path. Reconciled by an
// invariant: airdrop + dripPool + lp + team === totalSupply. Moves no funds; imported by nothing in the app.
//
// Operator decisions (MISFITZ-REWARDS.md §10): total 1B; 10% airdrop / 80% drip / 7% LP / 3% team (operator
// whale stake); drip 5%/mo of the remaining pool; burn = buy back then SEND to an unspendable address (no melt).

export const TOKEN_DECIMALS = 3;
export const UNITS_PER_TOKEN = BigInt(1000); // Chia CAT smallest unit (3 dp)

export interface TokenConfig {
  symbol: string;
  burnAddress: string;      // provably-unspendable address the bot sends bought-back tokens to (operator sets it)
  dripRateBps: number;      // 500 = 5% of the REMAINING drip pool each month
  totalSupplyUnits: bigint;
  airdropUnits: bigint;     // one-time airdrop to holders at launch
  dripPoolUnits: bigint;    // reserve released by the monthly drip
  lpUnits: bigint;          // seed TibetSwap liquidity
  teamUnits: bigint;        // operator/team allocation ("make me a whale")
}

const T = (tokens: number): bigint => BigInt(tokens) * UNITS_PER_TOKEN;

// 1,000,000,000 $TOKEN — 10% airdrop / 80% drip / 7% LP / 3% team. burnAddress + symbol are placeholders until
// the TAIL is minted and the token is named.
export const MISFITZ_TOKEN: TokenConfig = {
  symbol: "$TOKEN",
  burnAddress: "xch1__UNSPENDABLE_BURN_ADDRESS_TBD__",
  dripRateBps: 500,
  totalSupplyUnits: T(1_000_000_000),
  airdropUnits:     T(100_000_000), // 10%
  dripPoolUnits:    T(800_000_000), // 80%
  lpUnits:          T(70_000_000),  // 7%
  teamUnits:        T(30_000_000),  // 3%
};

// Invariant: every base unit is accounted for across the buckets.
export function reconciles(c: TokenConfig): boolean {
  return c.airdropUnits + c.dripPoolUnits + c.lpUnits + c.teamUnits === c.totalSupplyUnits;
}

// Month N's drip (base units) + the pool remaining after it. Geometric: 5% of the remaining pool each month,
// floored in bigint so we can never over-distribute. Month <= 0 returns a zero drip / full pool.
export function dripForMonth(poolUnits: bigint, month: number, rateBps: number): { drip: bigint; remainingAfter: bigint } {
  if (!Number.isFinite(month)) throw new Error(`dripForMonth: non-finite month ${month}`);
  if (rateBps < 0 || rateBps > 10000) throw new Error(`dripForMonth: rateBps out of range [0,10000]: ${rateBps}`);
  const R = BigInt(rateBps), TEN_K = BigInt(10000);
  let remaining = poolUnits;
  let drip = BigInt(0);
  for (let m = 1; m <= Math.max(0, Math.floor(month)); m++) {
    drip = (remaining * R) / TEN_K; // floor
    remaining -= drip;
  }
  return { drip, remainingAfter: remaining };
}

// Total dripped through `months` (base units). Monotonic; never exceeds the pool.
export function cumulativeDrip(poolUnits: bigint, months: number, rateBps: number): bigint {
  if (!Number.isFinite(months)) throw new Error(`cumulativeDrip: non-finite months ${months}`);
  if (rateBps < 0 || rateBps > 10000) throw new Error(`cumulativeDrip: rateBps out of range [0,10000]: ${rateBps}`);
  const R = BigInt(rateBps), TEN_K = BigInt(10000);
  let remaining = poolUnits;
  for (let m = 1; m <= Math.max(0, Math.floor(months)); m++) remaining -= (remaining * R) / TEN_K;
  return poolUnits - remaining;
}

export interface Circulating {
  releasedUnits: bigint;      // airdrop + team + lp + dripped-so-far (entered circulation)
  burnedUnits: bigint;        // bought back and sent to the burn address (removed)
  circulatingUnits: bigint;   // released - burned
  dripRemainingUnits: bigint; // still locked in the drip reserve
}

// Circulating supply after `monthsElapsed`, given cumulative tokens bought-back-and-burned (operator-reported,
// like the $CHIA conversion — the XCH burn pot buys $TOKEN on-market at a price the bot reports, then burns it).
export function circulating(c: TokenConfig, monthsElapsed: number, burnedUnits: bigint = BigInt(0)): Circulating {
  const dripped = cumulativeDrip(c.dripPoolUnits, monthsElapsed, c.dripRateBps);
  const released = c.airdropUnits + c.teamUnits + c.lpUnits + dripped;
  // Refuse impossible inputs rather than silently clamp — burned > released can only be an operator units/tokens
  // typo (×1000) and clamping would hide exactly that accounting bug.
  if (burnedUnits < BigInt(0)) throw new Error(`circulating: negative burnedUnits ${burnedUnits}`);
  if (burnedUnits > released) throw new Error(`circulating: burnedUnits ${burnedUnits} exceeds released ${released} — impossible, check units`);
  return {
    releasedUnits: released,
    burnedUnits,
    circulatingUnits: released - burnedUnits,
    dripRemainingUnits: c.dripPoolUnits - dripped,
  };
}

// Base units -> human token string (trims trailing zeros of the 3 decimals).
export function tokenStr(units: bigint): string {
  const neg = units < BigInt(0);
  const abs = neg ? -units : units;
  const whole = abs / UNITS_PER_TOKEN;
  const frac = (abs % UNITS_PER_TOKEN).toString().padStart(3, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
