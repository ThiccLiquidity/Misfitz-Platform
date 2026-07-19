// MisFitz Rewards — FROZEN deal-tag store (PURE). Spec §5: the deal tag (green->buyer / blue->none / yellow->
// seller) is FROZEN at the moment a sale is first detected, not recomputed later — so a green buy stays green
// even if the floor moves. We freeze the fair value per SALE (offerId), and the engine derives the tag from it
// via bonusWinnerFor (single source of truth). Only a RESOLVED (non-null) valuation is stamped, so a cold run
// can't freeze a wrong "none" — an unstamped sale simply retries next run. Writers: the cron + the on-view freeze — see
// resolveFvLookup in detectLive.ts. This module has no I/O; the live read/write lives in detectLive.

import { type RawSale } from "./detect";

export interface FrozenTag { fvXch: number; priceXch: number; capturedAt: number; soldAt: number }
export type TagStore = Record<string, FrozenTag>; // offerId -> frozen fair value at first detection

export const TAG_RETENTION_MS = 90 * 24 * 60 * 60_000; // keep well past a monthly epoch + finality + payout

// Drop entries whose capturedAt is older than retention. Retention (not the Redis TTL) is the real lifecycle.
export function pruneTags(store: TagStore, now: number, retentionMs = TAG_RETENTION_MS): { store: TagStore; changed: boolean } {
  let changed = false;
  const out: TagStore = {};
  for (const [k, v] of Object.entries(store)) {
    if (now - v.capturedAt <= retentionMs) out[k] = v;
    else changed = true;
  }
  return { store: out, changed };
}

// Freeze the fair value for any sale not already stamped. `computeFv(raw)` returns the CURRENT fair value (or
// null when it can't be valued — cold/thin model, unresolved rank). Only a real fv is stamped (null retries).
// Returns a lookup that yields the FROZEN fv for stamped sales and the just-computed fv for gaps, the updated
// store, and whether anything changed (so the caller only persists on change).
export function freezeInto(
  store: TagStore,
  raws: RawSale[],
  computeFv: (r: RawSale) => number | null,
  now: number,
): { fvOf: (r: RawSale) => number | null; store: TagStore; changed: boolean } {
  let changed = false;
  const next: TagStore = { ...store };
  for (const r of raws) {
    if (next[r.offerId]) continue; // already frozen — never recompute
    const fv = computeFv(r);
    if (fv == null || !(fv > 0)) continue; // couldn't value now -> don't stamp, retry next run
    next[r.offerId] = { fvXch: fv, priceXch: r.priceXch, capturedAt: now, soldAt: r.soldAt };
    changed = true;
  }
  const fvOf = (r: RawSale): number | null => next[r.offerId]?.fvXch ?? null;
  return { fvOf, store: next, changed };
}
