// MisFitz/$CHIPS Rewards — EPOCH LIFECYCLE registry (SERVER-ONLY, Redis-backed). Tracks each epoch's state so
// the dashboard can show a "closed / manifest ready / paid" badge and the bot can post receipts back. Moves no
// funds; this is bookkeeping only. All writes are guarded (fall back silently if Redis is unavailable).
//
// Lifecycle (monotonic — never moves backward):
//   open        — running month-to-date, nothing frozen
//   closed      — operator pressed Close; the final snapshot is frozen for this epoch
//   manifest    — operator downloaded the settlement document (recipient-list hash recorded)
//   paid        — the bot reported receipts; payout complete
if (typeof window !== "undefined") throw new Error("epochRegistry is server-only");

import { cacheGet, cachePut } from "@/lib/db/nftCache";

export type EpochStatus = "open" | "closed" | "manifest" | "paid";

const ORDER: Record<EpochStatus, number> = { open: 0, closed: 1, manifest: 2, paid: 3 };
const KEY = (col: string, epoch: string) => `rw:epoch:v1:${col}:${epoch}`;
const TTL_S = 400 * 24 * 60 * 60;        // keep epoch state ~13 months
const READ_TTL_MS = TTL_S * 1000;

export interface Receipt {
  kind: "reward" | "drip";
  txId: string;
  recipientCount: number;
  totalUnits: string;
  assetId: string;
  at: number;
}

export interface EpochState {
  collectionId: string;
  epochId: string;
  status: EpochStatus;
  closedAt?: number;
  closedPayoutAt?: number;      // the operator-chosen payout timestamp the final was computed at
  manifestAt?: number;
  recipientListHash?: string;   // from the downloaded settlement doc
  paidAt?: number;
  receipts?: Receipt[];
  updatedAt: number;
}

export async function readEpochState(colId: string, epoch: string): Promise<EpochState | null> {
  try {
    const raw = await cacheGet(KEY(colId, epoch), READ_TTL_MS);
    return raw ? (JSON.parse(raw) as EpochState) : null;
  } catch {
    return null;
  }
}

async function write(state: EpochState): Promise<void> {
  try {
    await cachePut(KEY(state.collectionId, state.epochId), JSON.stringify(state), TTL_S);
  } catch {
    /* best effort — bookkeeping only */
  }
}

// Advance the epoch to a new status, monotonically. Returns the resulting state. A request to move BACKWARD is
// ignored (the higher status stands), so a stray re-close after paid can't un-pay an epoch.
export async function advanceEpoch(
  colId: string,
  epoch: string,
  to: EpochStatus,
  patch: Partial<Omit<EpochState, "collectionId" | "epochId" | "status" | "updatedAt">> = {},
): Promise<EpochState> {
  const now = Date.now();
  const prev = await readEpochState(colId, epoch);
  const prevStatus = prev?.status ?? "open";
  const status: EpochStatus = ORDER[to] > ORDER[prevStatus] ? to : prevStatus;
  const next: EpochState = {
    collectionId: colId,
    epochId: epoch,
    ...prev,
    ...patch,
    status,
    updatedAt: now,
  };
  await write(next);
  return next;
}

// Record bot receipts and flip to "paid". Appends (idempotent-ish: dedupe by txId).
export async function recordReceipts(colId: string, epoch: string, receipts: Receipt[]): Promise<EpochState> {
  const prev = await readEpochState(colId, epoch);
  const existing = prev?.receipts ?? [];
  const seen = new Set(existing.map((r) => r.txId));
  const merged = [...existing, ...receipts.filter((r) => !seen.has(r.txId))];
  return advanceEpoch(colId, epoch, "paid", { receipts: merged, paidAt: Date.now() });
}
