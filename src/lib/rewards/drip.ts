// $TOKEN monthly drip simulator (pure, decision-support). "X% of the REMAINING treasury each month" =
// geometric decay: it front-loads and never hits zero. Fractions of the ORIGINAL treasury, so it's
// supply-agnostic (works whatever the absolute reserve is). Float is fine here — this is a projection, not
// the money path (that's all bigint in engine.ts).

export interface DripMonth {
  month: number;
  distributedFraction: number;  // paid THIS month, as a fraction of the original treasury
  cumulativeFraction: number;   // total distributed through this month
  remainingFraction: number;    // treasury left after this month
}

export function dripSchedule(rateBps: number, months: number): DripMonth[] {
  const rate = rateBps / 10000;
  let remaining = 1;
  const out: DripMonth[] = [];
  for (let m = 1; m <= months; m++) {
    const dist = remaining * rate;
    remaining -= dist;
    out.push({ month: m, distributedFraction: dist, cumulativeFraction: 1 - remaining, remainingFraction: remaining });
  }
  return out;
}

// Closed form: fraction of the original treasury distributed after `months` at `rateBps`.
export function cumulativeDistributed(rateBps: number, months: number): number {
  return 1 - Math.pow(1 - rateBps / 10000, months);
}

// Compare two rates at the milestones we care about (for the 5% vs 10% decision).
export function compareRates(aBps: number, bBps: number): { months: number; a: number; b: number }[] {
  return [6, 12, 24, 36].map((months) => ({
    months,
    a: cumulativeDistributed(aBps, months),
    b: cumulativeDistributed(bBps, months),
  }));
}
