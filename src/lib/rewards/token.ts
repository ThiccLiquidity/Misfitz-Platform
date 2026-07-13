// MisFitz Rewards — $TOKEN supply model (PURE). Fixed 1,000,000,000 supply split into buckets, a monthly
// GEOMETRIC drip (5% of the REMAINING drip pool), and buy-&-burn accounting. All amounts are bigint BASE UNITS
// (Chia CAT = 3 decimals, so 1 token = 1000 base units) — no floats on the supply path. Reconciled by an
// invariant: airdrop + dripPool + lpSeed + lpReward + team === totalSupply. Moves no funds.
//
// Operator decisions (MISFITZ-REWARDS.md §10 + §11): total 1B; 10% airdrop / 67% holder drip / 5% LP seed /
// 15% LP rewards / 3% team. Drip 5%/mo of the remaining pool; burn = buy back then SEND to an unspendable
// address (may be sent as LP tokens — a "burn into the pool"). The 15% LP-rewards reserve funds the tenure-
// escalating LP airdrop (§11); it is released by the LP-rewards program, NOT by the holder drip.

export const TOKEN_DECIMALS = 3;
export const UNITS_PER_TOKEN = BigInt(1000); // Chia CAT smallest unit (3 dp)

export interface TokenConfig {
  symbol: string;
  burnAddress: string;      // provably-unspendable address the bot sends bought-back tokens (or LP tokens) to
  dripRateBps: number;      // 500 = 5% of the REMAINING drip pool each month
  totalSupplyUnits: bigint;
  airdropUnits: bigint;     // one-time airdrop to holders at launch
  dripPoolUnits: bigint;    // reserve released by the monthly holder drip
  lpSeedUnits: bigint;      // one-time: pair with XCH to CREATE the TibetSwap $TOKEN/XCH pool
  lpRewardUnits: bigint;    // reserve for the tenure-escalating LP-holder airdrop (§11); released by the LP program
  teamUnits: bigint;        // operator/team allocation ("make me a whale")
}

const T = (tokens: number): bigint => BigInt(tokens) * UNITS_PER_TOKEN;

// 1,000,000,000 $TOKEN — 10% airdrop / 67% drip / 5% LP seed / 15% LP rewards / 3% team. burnAddress + symbol
// are placeholders until the TAIL is minted and the token is named.
export const MISFITZ_TOKEN: TokenConfig = {
  symbol: "$TOKEN",
  burnAddress: "xch1__UNSPENDABLE_BURN_ADDRESS_TBD__",
  dripRateBps: 500,
  totalSupplyUnits: T(1_000_000_000),
  airdropUnits:     T(100_000_000), // 10%
  dripPoolUnits:    T(670_000_000), // 67%
  lpSeedUnits:      T(50_000_000),  // 5%
  lpRewardUnits:    T(150_000_000), // 15%
  teamUnits:        T(30_000_000),  // 3%
};

// Invariant: every base unit is accounted for across the buckets.
export function reconciles(c: TokenConfig): boolean {
  return c.airdropUnits + c.dripPoolUnits + c.lpSeedUnits + c.lpRewardUnits + c.teamUnits === c.totalSupplyUnits;
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
  releasedUnits: bigint;       // airdrop + team + lpSeed + dripped-so-far (entered circulation)
  burnedUnits: bigint;         // bought back and sent to the burn address (removed)
  circulatingUnits: bigint;    // released - burned
  dripRemainingUnits: bigint;  // still locked in the holder-drip reserve
  lpRewardReserveUnits: bigint; // still locked in the LP-rewards reserve (released by the LP program, §11)
}

// Circulating supply after `monthsElapsed`, given cumulative tokens bought-back-and-burned (operator-reported).
// NOTE: the LP-rewards reserve is treated as LOCKED here (like the drip reserve) — its release schedule lives in
// the LP-rewards program (§11), so it is reported separately and NOT counted as released until that ships.
export function circulating(c: TokenConfig, monthsElapsed: number, burnedUnits: bigint = BigInt(0)): Circulating {
  const dripped = cumulativeDrip(c.dripPoolUnits, monthsElapsed, c.dripRateBps);
  const released = c.airdropUnits + c.teamUnits + c.lpSeedUnits + dripped;
  // Refuse impossible inputs rather than silently clamp — burned > released can only be an operator units/tokens
  // typo (x1000) and clamping would hide exactly that accounting bug.
  if (burnedUnits < BigInt(0)) throw new Error(`circulating: negative burnedUnits ${burnedUnits}`);
  if (burnedUnits > released) throw new Error(`circulating: burnedUnits ${burnedUnits} exceeds released ${released} — impossible, check units`);
  return {
    releasedUnits: released,
    burnedUnits,
    circulatingUnits: released - burnedUnits,
    dripRemainingUnits: c.dripPoolUnits - dripped,
    lpRewardReserveUnits: c.lpRewardUnits,
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
