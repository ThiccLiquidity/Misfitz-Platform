import { fetchCollectionFloor, fetchCollectionSaleFloor, fetchCollectionFloorWarm, fetchCollectionSaleFloorWarm } from "./dexie";

// TRUSTED-FLOOR resolver — the single chokepoint that stops troll/never-sell listings from poisoning values.
// Owner-decided rules (VALUATION-MODEL.md §4a):
//   1. A floor is TRUSTED only when the collection has REAL completed sales. No sales -> the cheapest ask is
//      INDICATIVE only: shown (labeled unverified) but it produces NO estimate and contributes 0 to totals.
//   2. When sales exist, the value floor is CAPPED at SALES_CAP_MULT × the recent-sales anchor, so a single
//      9,999,999 XCH troll ask can't inflate the collection cap or a holder's portfolio.
// Frozen valuation params are untouched — this only sanitizes the floor INPUT.
const _capMult = Number(process.env.TRAITFOLIO_SALES_CAP_MULT);
export const SALES_CAP_MULT = _capMult > 0 ? _capMult : 4;

export type FloorTrust = "sales-backed" | "indicative" | "none";

export interface TrustedFloor {
  valueFloor: number | null;  // floor to VALUE against; null = unpriced (no estimate, 0 into totals)
  displayAsk: number | null;  // cheapest ask to SHOW (may be a troll — label it unverified)
  salesAnchor: number | null; // recent-sales floor, when sales exist
  trust: FloorTrust;
  capped: boolean;            // a troll ask above the cap was pulled down to the sales-anchored ceiling
}

// PURE core (unit-tested): decide the trusted floor from the two already-fetched signals.
export function trustedFloorFrom(salesAnchor: number | null, listingFloor: number | null, mgFloor?: number | null): TrustedFloor {
  const ask = (typeof listingFloor === "number" && listingFloor > 0) ? listingFloor
    : (typeof mgFloor === "number" && mgFloor > 0) ? mgFloor : null;
  if (salesAnchor == null || salesAnchor <= 0) {
    // No sales -> unpriced. Show the ask (if any) as indicative; value against nothing.
    return { valueFloor: null, displayAsk: ask, salesAnchor: null, trust: ask != null ? "indicative" : "none", capped: false };
  }
  const cap = SALES_CAP_MULT * salesAnchor;
  const raw = ask ?? salesAnchor;
  const valueFloor = Math.min(raw, cap);
  return { valueFloor, displayAsk: ask, salesAnchor, trust: "sales-backed", capped: ask != null && ask > cap };
}

// Blocking resolve (collection page / deal scoring — anchored to the true, sanitized floor).
export async function resolveTrustedFloor(colId: string, mgFloor?: number | null): Promise<TrustedFloor> {
  const [salesAnchor, listingFloor] = await Promise.all([
    fetchCollectionSaleFloor(colId).catch(() => null),
    fetchCollectionFloor(colId).catch(() => null),
  ]);
  return trustedFloorFrom(salesAnchor, listingFloor, mgFloor);
}

// Non-blocking resolve (binder/portfolio — reads the last cached floors instantly, warms in the background).
export function resolveTrustedFloorWarm(colId: string, mgFloor?: number | null): TrustedFloor {
  return trustedFloorFrom(fetchCollectionSaleFloorWarm(colId), fetchCollectionFloorWarm(colId), mgFloor);
}
