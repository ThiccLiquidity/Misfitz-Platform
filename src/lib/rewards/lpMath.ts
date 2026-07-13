// MisFitz Rewards - LP-holder airdrop MATH (PURE, tested). Rewards holding $TOKEN/XCH liquidity: paid monthly,
// weighted by a wallet's time-weighted average LP balance (TWAB) x a tenure multiplier that grows the longer the
// balance is held. TENURE IS PER-UNIT, via COHORTS: each chunk of liquidity ages on its own clock, so capital
// ADDED this month starts at 1x and only reaches 5x after ITS OWN 18 months - you cannot park dust for a year
// then deploy capital at 5x, and reducing liquidity removes your NEWEST units first (LIFO) so genuinely-aged
// units keep their tenure. Fully exiting drops all cohorts (tenure resets). Uses the solvent allocator, so
// sum(payouts) === release exactly. Balances are bigint base units; multipliers are floats (weight/display only).
//
// Tenure curve (months a cohort has been held): 1x@1, 1.5x@3, 2.5x@6, 4x@12, 5x@18 (cap). MISFITZ-REWARDS.md 11.3.

import { allocateDrip } from "./allocator";

export const LP_MULT_CAP = 5.0;
const CAP_MONTHS = 18;
const UNITS_PER_TOKEN = 1000; // LP CAT is a Chia CAT (3 dp); scale bigint units -> token float (weight/display only)
const Z = BigInt(0);
const tokens = (units: bigint): number => Number(units) / UNITS_PER_TOKEN;

// Consecutive-month tenure -> reward multiplier. Piecewise-linear through the locked anchors. months < 1 -> 0.
export function tenureMultiplier(monthsHeld: number): number {
  const m = Math.floor(monthsHeld);
  if (m < 1) return 0;
  if (m <= 3) return 1 + (m - 1) * 0.25;       // 1..3:  1x   -> 1.5x
  if (m <= 6) return 1.5 + (m - 3) * (1 / 3);  // 3..6:  1.5x -> 2.5x
  if (m <= 12) return 2.5 + (m - 6) * 0.25;    // 6..12: 2.5x -> 4x
  if (m < 18) return 4 + (m - 12) * (1 / 6);   // 12..18: 4x  -> 5x
  return LP_MULT_CAP;
}

export function twab(dailyBalances: bigint[]): bigint {
  if (dailyBalances.length === 0) return Z;
  let sum = Z;
  for (const b of dailyBalances) sum += b < Z ? Z : b;
  return sum / BigInt(dailyBalances.length);
}

export function nextTenure(prevTenure: number, presentThisEpoch: boolean): number {
  if (!presentThisEpoch) return 0;
  return Math.max(0, Math.floor(prevTenure)) + 1;
}

// Simple (no-cohort) weight: LP tokens x tenure multiplier. Retained for the direct computeLpEpoch helper/tests.
export function lpWeight(twabUnits: bigint, monthsHeld: number): number {
  if (twabUnits <= Z) return 0;
  return tokens(twabUnits) * tenureMultiplier(monthsHeld);
}

export interface LpEntry { wallet: string; twabUnits: bigint; monthsHeld: number }
export interface LpWalletReward {
  wallet: string;
  twabUnits: bigint;
  monthsHeld: number;  // tenure of the wallet's LARGEST cohort (representative "tier")
  multiplier: number;  // EFFECTIVE blended multiplier realized this epoch (weight / tokens(TWAB))
  tokenUnits: bigint;
}
export interface LpEpochResult {
  releaseUnits: bigint;
  distributedUnits: bigint;
  eligibleCount: number;
  wallets: LpWalletReward[];
  solvent: boolean;
}

// Simple split (whole TWAB at one tenure). Used by tests / as a no-history helper.
export function computeLpEpoch(entries: LpEntry[], releaseUnits: bigint): LpEpochResult {
  const eligible = entries.filter((e) => lpWeight(e.twabUnits, e.monthsHeld) > 0);
  const holdings = eligible.map((e) => ({ wallet: e.wallet, weight: lpWeight(e.twabUnits, e.monthsHeld) }));
  const drip = allocateDrip(holdings, releaseUnits);
  const byWallet = new Map(eligible.map((e) => [e.wallet, e]));
  const wallets: LpWalletReward[] = drip.wallets.map((w) => {
    const e = byWallet.get(w.wallet)!;
    return { wallet: w.wallet, twabUnits: e.twabUnits, monthsHeld: e.monthsHeld, multiplier: tenureMultiplier(e.monthsHeld), tokenUnits: w.tokenUnits };
  });
  const distributed = wallets.reduce((s, w) => s + w.tokenUnits, Z);
  return { releaseUnits, distributedUnits: distributed, eligibleCount: eligible.length, wallets, solvent: drip.solvent };
}

// ── Cohort tenure (PURE) ─────────────────────────────────────────────────────────
export interface EpochObservation { runs: number; sums: Record<string, bigint> }
export interface LpCohort { units: bigint; months: number }

// Age a wallet's cohorts by one month and resize the total to this epoch's TWAB `t`. New capital -> a fresh
// month-1 cohort; a reduction removes NEWEST units first (LIFO) so aged units keep their tenure; matured
// (>=18mo) cohorts merge into one capped cohort to bound the list. A full exit (t<=0) drops everything.
export function rollCohorts(prev: LpCohort[], t: bigint): LpCohort[] {
  if (t <= Z) return [];
  let aged = prev.map((c) => ({ units: c.units < Z ? Z : c.units, months: c.months + 1 })).filter((c) => c.units > Z);
  aged.sort((a, b) => b.months - a.months); // oldest first
  const total = aged.reduce((s, c) => s + c.units, Z);
  if (t > total) {
    aged.push({ units: t - total, months: 1 }); // fresh capital, its own clock
  } else if (t < total) {
    let remove = total - t;
    for (let i = aged.length - 1; i >= 0 && remove > Z; i--) { // trim the newest cohorts first
      if (aged[i].units <= remove) { remove -= aged[i].units; aged[i].units = Z; }
      else { aged[i].units -= remove; remove = Z; }
    }
    aged = aged.filter((c) => c.units > Z);
  }
  const matured = aged.filter((c) => c.months >= CAP_MONTHS).reduce((s, c) => s + c.units, Z);
  const young = aged.filter((c) => c.months < CAP_MONTHS);
  if (matured > Z) young.push({ units: matured, months: CAP_MONTHS });
  young.sort((a, b) => b.months - a.months);
  return young;
}

function cohortWeight(cohorts: LpCohort[]): number {
  let w = 0;
  for (const c of cohorts) w += tokens(c.units) * tenureMultiplier(c.months);
  return w;
}
function topCohortMonths(cohorts: LpCohort[]): number {
  let best = 0; let bestUnits = Z;
  for (const c of cohorts) if (c.units > bestUnits) { bestUnits = c.units; best = c.months; }
  return best;
}

// Roll an epoch: observations + prior cohorts -> this epoch's rewards + the next cohort state. TWAB = sum/runs.
// Excluded wallets dropped. On advanceTenure, nextState is the observed wallets' new cohorts (absent -> reset);
// an empty/zero-run epoch (outage) preserves the prior state.
export function rollLpEpoch(
  obs: EpochObservation,
  prevState: Record<string, LpCohort[]>,
  releaseUnits: bigint,
  opts: { advanceTenure: boolean; excluded?: Set<string> },
): { result: LpEpochResult; nextState: Record<string, LpCohort[]> } {
  const excluded = opts.excluded ?? new Set<string>();
  const runs = Math.max(0, Math.floor(obs.runs));
  const twabOf = (wallet: string): bigint => {
    if (runs <= 0) return Z;
    const s = obs.sums[wallet] ?? Z;
    return (s < Z ? Z : s) / BigInt(runs);
  };

  const weights: { wallet: string; weight: number }[] = [];
  const meta = new Map<string, { twab: bigint; months: number; mult: number }>();
  const nextCohorts = new Map<string, LpCohort[]>();
  for (const wallet of Object.keys(obs.sums)) {
    if (excluded.has(wallet)) continue;
    const t = twabOf(wallet);
    const cohorts = rollCohorts(prevState[wallet] ?? [], t);
    nextCohorts.set(wallet, cohorts);
    const weight = cohortWeight(cohorts);
    if (weight > 0) weights.push({ wallet, weight });
    meta.set(wallet, { twab: t, months: topCohortMonths(cohorts), mult: t > Z ? weight / tokens(t) : 0 });
  }

  const drip = allocateDrip(weights, releaseUnits);
  const wallets: LpWalletReward[] = drip.wallets.map((w) => {
    const m = meta.get(w.wallet)!;
    return { wallet: w.wallet, twabUnits: m.twab, monthsHeld: m.months, multiplier: m.mult, tokenUnits: w.tokenUnits };
  });
  const distributed = wallets.reduce((s, w) => s + w.tokenUnits, Z);
  const result: LpEpochResult = { releaseUnits, distributedUnits: distributed, eligibleCount: weights.length, wallets, solvent: drip.solvent };

  let nextState = prevState;
  if (opts.advanceTenure) {
    if (runs <= 0 || Object.keys(obs.sums).length === 0) {
      nextState = prevState; // outage: don't wipe everyone's cohorts
    } else {
      nextState = {};
      for (const [wallet, cohorts] of nextCohorts) if (cohorts.length > 0) nextState[wallet] = cohorts; // absent/exited -> dropped (reset)
    }
  }
  return { result, nextState };
}
