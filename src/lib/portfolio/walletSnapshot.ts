import { createHash } from "node:crypto";
import type { NftData } from "@/types";
import { cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { listAddressNfts } from "@/lib/data-sources/mintgarden/client";

// ── Persistent wallet memory (free, account-free) ────────────────────────────────────────────────
// A per-ADDRESS-SET snapshot of the fully-stamped binder (cards with traits+ranks+values). Keyed by a
// hash of the public address set — no accounts, no payment. On a return visit we serve it instantly and
// only re-do work if a cheap "did the wallet change?" probe (one page-1 fetch per address) says so.
// Everything degrades to the normal load on any miss/failure; the snapshot is never on the critical path.

export const PWALLET_ENABLED = process.env.TRAITFOLIO_PWALLET === "1" || process.env.TRAITFOLIO_PWALLET === "true";

const SNAP_VERSION = 2;
export const SNAP_TTL_MS = 14 * 24 * 60 * 60_000;    // read/persist window = the "memory"
const SNAP_TTL_S = 14 * 24 * 60 * 60;
export const SNAP_TRUST_MS = 10 * 60_000;            // younger than this: serve with NO probe
export const SNAP_REVALIDATE_MS = 60 * 60_000;       // older than this (but unchanged): serve + rebuild in bg
const WRITE_GATE_MS = 10 * 60_000;                   // at most one write per key per 10 min per instance
const _lastWrite = new Map<string, number>();

interface AddrProbe { fp: string; hasNext: boolean; count: number }
export interface WalletSnapshot {
  v: number;
  writtenAt: number;
  addresses: string[];
  cards: NftData[];        // fully stamped (post seed + index + artifact stamp); values in XCH
  coldCols: string[];      // collections the stamp couldn't cover (client finishes them)
  truncated: boolean;
  asOf: number | null;
  probe: Record<string, AddrProbe>; // per-address page-1 fingerprint for the change probe
}

export function snapshotKeyFor(addresses: string[]): string {
  const norm = addresses.map((a) => a.trim().toLowerCase()).sort().join("|");
  return "pwallet:" + createHash("sha256").update(norm).digest("hex").slice(0, 24);
}
function sha(s: string): string { return createHash("sha256").update(s).digest("hex").slice(0, 32); }

// One cheap page-1 fetch -> a fingerprint of what the address currently holds (order-independent).
async function addrProbe(addr: string): Promise<AddrProbe | null> {
  try {
    const page = await listAddressNfts(addr, undefined, 50, "owned");
    const ids = (page.items ?? []).map((it) => it.encoded_id).filter(Boolean).sort();
    return { fp: sha(ids.join(",")), hasNext: !!page.next, count: ids.length };
  } catch { return null; }
}

export async function readWalletSnapshot(addresses: string[]): Promise<WalletSnapshot | null> {
  try {
    const raw = await cacheGetLarge(snapshotKeyFor(addresses), SNAP_TTL_MS);
    if (!raw) return null;
    const snap = JSON.parse(raw) as WalletSnapshot;
    if (snap.v !== SNAP_VERSION || !Array.isArray(snap.cards)) return null;
    return snap;
  } catch { return null; }
}

export async function writeWalletSnapshot(
  addresses: string[], cards: NftData[],
  opts: { coldCols?: string[]; truncated?: boolean; asOf?: number | null } = {},
): Promise<void> {
  const key = snapshotKeyFor(addresses);
  const now = Date.now();
  if (now - (_lastWrite.get(key) ?? 0) < WRITE_GATE_MS) return; // gate churn
  _lastWrite.set(key, now);
  const probes = await Promise.all(addresses.map(async (a) => [a, await addrProbe(a)] as const));
  const probe: Record<string, AddrProbe> = {};
  for (const [a, p] of probes) if (p) probe[a] = p;
  const snap: WalletSnapshot = {
    v: SNAP_VERSION, writtenAt: now, addresses,
    cards, coldCols: opts.coldCols ?? [], truncated: !!opts.truncated, asOf: opts.asOf ?? null, probe,
  };
  try { await cachePutLargeAsync(key, JSON.stringify(snap), SNAP_TTL_S); } catch { /* best effort */ }
}

// true = provably unchanged, false = changed, null = probe failed (caller may serve-stale + revalidate).
export async function probeWalletUnchanged(addresses: string[], snap: WalletSnapshot): Promise<boolean | null> {
  let anyFail = false;
  for (const addr of addresses) {
    const prev = snap.probe[addr];
    if (!prev) return null; // no baseline to compare -> can't confirm
    const now = await addrProbe(addr);
    if (!now) { anyFail = true; continue; }
    if (now.fp !== prev.fp || now.hasNext !== prev.hasNext || now.count !== prev.count) return false;
  }
  return anyFail ? null : true;
}

// USD fields drift with the XCH→USD rate; recompute them from the current rate on a served snapshot.
export function refreshUsd(cards: NftData[], xchUsdRate: number): void {
  for (const c of cards) {
    if (c.fairValue) c.fairValue.totalEstimateUsd = Math.round(c.fairValue.totalEstimate * xchUsdRate * 100) / 100;
    if (c.listing) c.listing.priceUsd = Math.round(c.listing.priceXch * xchUsdRate * 100) / 100;
  }
}
