// Value range + confidence (VALUATION.md Part 3). We never show a bare number: a point estimate
// comes with a *capped* range whose width reflects how much real market data backs it. Thin data
// = lower confidence (and a modestly wider band), never an ugly 1–9 XCH spread.

export type Confidence = "low" | "medium" | "high";

// Capped half-widths — confidence, not an enormous band, carries the uncertainty.
const HALF_WIDTH: Record<Confidence, number> = { high: 0.08, medium: 0.18, low: 0.28 };

export interface ConfidenceInputs {
  activeListings: number; // comparable active asks backing the floor
  recentSales: number; // comparable recent sales (last ~30d)
}

export function confidenceFor({ activeListings, recentSales }: ConfidenceInputs): Confidence {
  if (recentSales >= 5 && activeListings >= 5) return "high";
  if (recentSales >= 2 || activeListings >= 3) return "medium";
  return "low";
}

export interface ValueRange {
  point: number;
  low: number;
  high: number;
  confidence: Confidence;
}

export function valueRange(point: number, inputs: ConfidenceInputs): ValueRange {
  const confidence = confidenceFor(inputs);
  const w = HALF_WIDTH[confidence];
  const r = (x: number) => Math.round(x * 100) / 100;
  return { point: r(point), low: r(point * (1 - w)), high: r(point * (1 + w)), confidence };
}
