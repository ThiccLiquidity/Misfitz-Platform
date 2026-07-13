// MisFitz Rewards — PURE detection mapping. Turns raw+attributed MisFitz sales into the engine's Sale[] /
// VestSignal[]. This file stays DEPENDENCY-LIGHT on purpose: it imports only the shared deal-score function
// (so bonus tags match the site exactly — no new thresholds) and the rewards types. The live network I/O that
// actually fetches sales lives in `detectLive.ts` — kept separate so this logic is unit-testable with no
// network and no heavy app graph. See MISFITZ-REWARDS.md §5 for the locked decisions this implements.

import { computeDealScore } from "@/lib/rarity/enrich";
import { DEFAULT_CONFIG, MOJOS_PER_XCH, type BonusWinner, type RewardConfig, type Sale, type VestSignal } from "./types";

export const FINALITY_MS = 10 * 60_000; // a sale must be this many ms old before epoch close to count (else rolls over)

// XCH -> mojos, EXACT via string (no float drift). Reasonable-magnitude prices only; clamps junk to 0.
export function XCH(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return BigInt(0);
  const [w, f = ""] = n.toFixed(12).split(".");
  return BigInt(w) * MOJOS_PER_XCH + BigInt((f + "000000000000").slice(0, 12));
}

// A raw sale pulled from Dexie, plus attribution filled in from MintGarden events (best-effort, upstream).
export interface RawSale {
  offerId: string;      // stable sale id (Dexie offer id)
  nftId: string;        // NFT that changed hands (Dexie 'id' = launcher id)
  priceXch: number;     // sale price in XCH
  soldAt: number;       // ms epoch (completion time)
  buyer?: string | null;
  seller?: string | null;
}

export interface ActiveListing { nftId: string; priceXch: number; at: number }

// Which side (if any) earns the deal bonus. Mirrors the site's deal score exactly (same scorer the cards use):
//   score >= 60  -> buyer scooped it clearly under value  -> buyer bonus
//   score <  40  -> seller sold clearly over value        -> seller bonus
//   otherwise    -> fair                                  -> no bonus (that slice goes to burn)
// A missing/zero FV yields "none" (base rewards only) — we never award a bonus we can't justify.
export function bonusWinnerFor(priceXch: number, fvXch: number | null | undefined): BonusWinner {
  if (!fvXch || fvXch <= 0 || priceXch <= 0) return "none";
  const score = computeDealScore(fvXch, priceXch).score;
  if (score >= 60) return "buyer";
  if (score < 40) return "seller";
  return "none";
}

// Build one engine Sale from a raw+attributed sale. Royalty is 10% of price (trusted in shadow mode); unknown
// counterparties get a stable placeholder wallet so base rewards still tally without inventing an identity.
export function toSale(raw: RawSale, fvXch: number | null | undefined, cfg: RewardConfig = DEFAULT_CONFIG): Sale {
  const priceMojos = XCH(raw.priceXch);
  const royaltyMojos = (priceMojos * BigInt(cfg.royaltyBps)) / BigInt(10000);
  return {
    id: raw.offerId,
    nftId: raw.nftId,
    buyer: raw.buyer || `unknown-buyer:${raw.offerId}`,
    seller: raw.seller || `unknown-seller:${raw.offerId}`,
    priceMojos,
    royaltyMojos,
    bonusWinner: bonusWinnerFor(raw.priceXch, fvXch),
    soldAt: raw.soldAt,
  };
}

// A sale COUNTS for this epoch iff it settled in the finality-shifted, half-open window
// [start - finalityMs, end - finalityMs). Shifting by finality makes consecutive epochs an EXACT partition
// (epoch N+1 starts where N ended), so a last-minute sale genuinely rolls to the next epoch instead of being
// dropped by both. Pure predicate.
export function inWindow(raw: RawSale, start: number, end: number, finalityMs = FINALITY_MS): boolean {
  return raw.soldAt >= start - finalityMs && raw.soldAt < end - finalityMs;
}

// Every observed sale is a potential VOID signal for an EARLIER purchase of the same NFT (resold cheaper).
export function saleSignals(raws: RawSale[]): VestSignal[] {
  return raws.map((r) => ({ nftId: r.nftId, priceMojos: XCH(r.priceXch), at: r.soldAt, kind: "sale" as const }));
}

// Active listings are potential VOID signals too (listed cheaper than purchase before payout).
export function listSignals(listings: ActiveListing[]): VestSignal[] {
  return listings.map((l) => ({ nftId: l.nftId, priceMojos: XCH(l.priceXch), at: l.at, kind: "list" as const }));
}

// Turn raw sales + listings into the engine's inputs. Sales counted are the in-window, final ones; vest
// signals include ALL sales in [start, end] (so a still-in-window later sale can void an earlier bonus) plus
// the current listings. fvLookup returns the frozen deal-tag FV for a sale (null -> no bonus). Pure.
export function buildEpochInputs(
  raws: RawSale[],
  start: number,
  end: number,
  fvLookup: (r: RawSale) => number | null,
  listings: ActiveListing[] = [],
  finalityMs = FINALITY_MS,
): { sales: Sale[]; signals: VestSignal[] } {
  const counted = raws.filter((r) => inWindow(r, start, end, finalityMs));
  const sales = counted.map((r) => toSale(r, fvLookup(r)));
  const windowSales = raws.filter((r) => r.soldAt >= start - finalityMs && r.soldAt <= end);
  const signals = [...saleSignals(windowSales), ...listSignals(listings)];
  return { sales, signals };
}
