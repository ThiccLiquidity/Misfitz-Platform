import { fetchCollectionSaleFloor, fetchCollectionSaleFloorWarm, fetchCollectionAsks, fetchCollectionAsksWarm } from "./dexie";
import { robustFloor } from "@/lib/valuation/estimate";

// TRUSTED-FLOOR resolver — the single chokepoint that stops troll/never-sell listings from poisoning values.
// Owner-decided rules (VALUATION-MODEL.md §4a):
//   1. A floor is TRUSTED only when the collection has REAL completed sales. No sales -> the cheapest ask is
//      INDICATIVE only: shown (labeled unverified) but it produces NO estimate and contributes 0 to totals.
//   2. When sales exist, the value floor is the ROBUST floor = median of the cheapest ~5 clean asks, which a
//      single troll / fat-finger listing can't move — so a legit price run-up (many consistent listings) shows
//      its true floor, while a lone outlier is ignored. Only when listings are THIN (< MIN_ROBUST_ASKS, where a
//      single ask could itself be the troll) do we sanity-cap the ask at SALES_CAP_MULT × the recent-sales
//      anchor. Frozen model params are untouched — this only sanitizes the floor INPUT.
const _capMult = Number(process.env.TRAITFOLIO_SALES_CAP_MULT);
export const SALES_CAP_MULT = _capMult > 0 ? _capMult : 4; // thin-collection sanity cap only
export const MIN_ROBUST_ASKS = 3; // >= this many clean asks => trust the robust median (a run-up is real)

export type FloorTrust = "sales-backed" | "indicative" | "none";

export interface TrustedFloor {
  valueFloor: number | null;  // floor to VALUE against; null = unpriced (no estimate, 0 into totals)
  displayAsk: number | null;  // cheapest ask to SHOW (may be a troll — label it unverified)
  salesAnchor: number | null; // recent-sales floor, when sales exist
  trust: FloorTrust;
  capped: boolean;            // a thin-collection ask above the cap was pulled down to the sales ceiling
}

// PURE core (unit-tested): decide the trusted floor from the already-fetched signals.
export function trustedFloorFrom(salesAnchor: number | null, asks: number[], mgFloor?: number | null): TrustedFloor {
  const clean = (asks ?? []).filter((p) => typeof p === "number" && p > 0).sort((a, b) => a - b);
  const mg = (typeof mgFloor === "number" && mgFloor > 0) ? mgFloor : null;
  const robust = robustFloor(clean) ?? mg;       // median of cheapest 5; falls back to MintGarden floor
  const displayAsk = clean[0] ?? mg;             // cheapest ask (may be a troll)

  if (salesAnchor == null || salesAnchor <= 0) {
    // No sales -> unpriced. Show the ask (if any) as indicative; value against nothing.
    return { valueFloor: null, displayAsk, salesAnchor: null, trust: displayAsk != null ? "indicative" : "none", capped: false };
  }
  // Sales-backed. With enough clean asks the robust median IS the floor (a single troll can't move it), so a
  // genuine run-up shows its true price. Thin collections (a lone ask) get the sales sanity-cap.
  if (clean.length >= MIN_ROBUST_ASKS && robust != null) {
    return { valueFloor: robust, displayAsk, salesAnchor, trust: "sales-backed", capped: false };
  }
  const cap = SALES_CAP_MULT * salesAnchor;
  const raw = robust ?? salesAnchor;
  const valueFloor = Math.min(raw, cap);
  return { valueFloor, displayAsk, salesAnchor, trust: "sales-backed", capped: robust != null && robust > cap };
}

// Blocking resolve (collection page / deal scoring — anchored to the true, sanitized floor).
export async function resolveTrustedFloor(colId: string, mgFloor?: number | null): Promise<TrustedFloor> {
  const [salesAnchor, asks] = await Promise.all([
    fetchCollectionSaleFloor(colId).catch(() => null),
    fetchCollectionAsks(colId).catch(() => [] as number[]),
  ]);
  return trustedFloorFrom(salesAnchor, asks, mgFloor);
}

// Non-blocking resolve (binder/portfolio — reads the last cached signals instantly, warms in the background).
export function resolveTrustedFloorWarm(colId: string, mgFloor?: number | null): TrustedFloor {
  return trustedFloorFrom(fetchCollectionSaleFloorWarm(colId), fetchCollectionAsksWarm(colId), mgFloor);
}
