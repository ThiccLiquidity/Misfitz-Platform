// MisFitz Rewards - LP-rewards SHADOW job (SERVER-ONLY, network). Observes each MisFitz-holder wallet's LP-CAT
// balance daily (accumulating sum + a global run count for a TWAB), then monthly computes the tenure-escalating
// LP airdrop and persists a public snapshot. Flag-gated; moves no funds; NullLpProvider by default so it's a
// no-op until the pool + a real on-chain balance reader are wired. Pure roll math lives in lpMath.rollLpEpoch.
if (typeof window !== "undefined") throw new Error("rewards/lpJob is server-only");

import { cacheGet, cachePut, cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { isRewardsShadowEnabled } from "./flag";
import { getLpProvider, fetchTokenPair, lpExcludedWallets, LP_REWARD_RATE_BPS } from "./lpProvider";
import { rollLpEpoch, tenureMultiplier, type EpochObservation, type LpCohort } from "./lpMath";
import { dripForMonth, MISFITZ_TOKEN } from "./token";
import { resolveIdentities } from "./identity";
import { truncWallet } from "./snapshotTypes";
import type { LpSnapshotDTO, LpLeader } from "./lpTypes";
import type { MgListItem } from "@/lib/data-sources/mintgarden/types";

const EX_S = 60 * 24 * 60 * 60;
const READ_TTL = 45 * 24 * 60 * 60_000;
const OBS_TTL_MS = 40 * 24 * 60 * 60_000;
const SLIMLIST_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_OBSERVE = 5000; // cap wallets read per day (bounds real-provider cost; roster-scoped by design)
const OBSERVE_CONCURRENCY = 8;
const LEADER_N = 10;

const OBS_KEY = (c: string, e: string) => `rw:lpobs:v1:${c}:${e}`;   // per-epoch { runs, bal } observation store
const TEN_KEY = (c: string) => `rw:lptenure:v1:${c}`;                // per-wallet consecutive-month tenure
const SNAP_KEY = (c: string, e: string) => `rw:lpsnap:v1:${c}:${e}`;
const SNAP_PTR = (c: string) => `rw:lpsnap:latest:${c}`;

interface ObsStore { runs: number; bal: Record<string, string> } // bal[wallet] = summed daily balances (string)
type StoredCohort = { u: string; m: number };                 // {units, months} persisted (units as string)
type StateStore = Record<string, StoredCohort[]>;             // per-wallet cohort list (persisted)

async function mapPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => { while (next < items.length) { const i = next++; await worker(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// Distinct MisFitz-holder wallets from the cached roster, minus excluded (operator/team/seed). Capped.
async function rosterWallets(colId: string, excluded: Set<string>): Promise<string[]> {
  let raw: string | null = null;
  try { raw = await cacheGetLarge(`slimlist2:${colId}`, SLIMLIST_TTL_MS); } catch { raw = null; }
  if (!raw) return [];
  let items: MgListItem[] = [];
  try { items = (JSON.parse(raw) as { items?: MgListItem[] }).items ?? []; } catch { return []; }
  const seen = new Set<string>();
  for (const it of items) {
    const w = it.owner_address_encoded_id;
    if (!w || excluded.has(w.toLowerCase())) continue;
    seen.add(w);
    if (seen.size >= MAX_OBSERVE) break;
  }
  return [...seen];
}

// Daily: add each roster wallet's current LP balance to this epoch's sum and bump the global run count. No-op
// until the pool is live. Reads/writes with the LARGE cache API consistently (a 5k-wallet blob is sharded).
export async function observeLpDaily(colId: string, epoch: string): Promise<{ ok: boolean; poolLive: boolean; observed: number }> {
  if (!isRewardsShadowEnabled()) return { ok: false, poolLive: false, observed: 0 };
  const pair = await fetchTokenPair();
  if (!pair) return { ok: true, poolLive: false, observed: 0 };
  const excluded = lpExcludedWallets();
  const provider = getLpProvider();
  const wallets = await rosterWallets(colId, excluded);

  let obs: ObsStore = { runs: 0, bal: {} };
  try { const raw = await cacheGetLarge(OBS_KEY(colId, epoch), OBS_TTL_MS); if (raw) obs = JSON.parse(raw) as ObsStore; } catch { /* fresh */ }
  if (!obs.bal) obs.bal = {};

  await mapPool(wallets, OBSERVE_CONCURRENCY, async (w) => {
    const bal = await provider.lpBalanceUnits(w, pair.liquidityAssetId).catch(() => BigInt(0));
    if (bal > BigInt(0)) obs.bal[w] = (BigInt(obs.bal[w] ?? "0") + bal).toString();
  });
  obs.runs = (obs.runs ?? 0) + 1; // global run count -> TWAB = sum/runs (missing days count as 0)

  try { await cachePutLargeAsync(OBS_KEY(colId, epoch), JSON.stringify(obs), OBS_TTL_MS / 1000); } catch { /* best effort */ }
  return { ok: true, poolLive: true, observed: wallets.length };
}

export interface LpComputeOpts { epoch: string; dripMonth: number; status: "mtd" | "final"; advanceTenure: boolean; updatePointer?: boolean }

// Monthly (or MTD preview): roll observations + prior tenure into rewards via the pure rollLpEpoch, then persist.
// FINAL persists the advanced tenure BEFORE the snapshot (so a swallowed tenure-write can't be masked by the
// cron's "already final" guard).
export async function computeLpSnapshot(colId: string, opts: LpComputeOpts): Promise<{ ok: boolean; status: string }> {
  if (!isRewardsShadowEnabled()) return { ok: false, status: "disabled" };
  const pair = await fetchTokenPair();
  const computedAt = Date.now();

  let store: ObsStore = { runs: 0, bal: {} };
  try { const raw = await cacheGetLarge(OBS_KEY(colId, opts.epoch), OBS_TTL_MS); if (raw) store = JSON.parse(raw) as ObsStore; } catch { /* none */ }
  let stored: Record<string, unknown> = {};
  try { const raw = await cacheGetLarge(TEN_KEY(colId), READ_TTL); if (raw) stored = JSON.parse(raw) as Record<string, unknown>; } catch { /* none */ }
  const bigOrZero = (x: unknown): bigint => { try { const b = BigInt(String(x)); return b < BigInt(0) ? BigInt(0) : b; } catch { return BigInt(0); } };
  const prevState: Record<string, LpCohort[]> = {};
  for (const [w, v] of Object.entries(stored)) {
    if (Array.isArray(v)) { // new cohort format
      prevState[w] = v.map((c) => ({ units: bigOrZero((c as StoredCohort)?.u), months: Math.max(0, Math.floor((c as StoredCohort)?.m ?? 0)) })).filter((c) => c.units > BigInt(0));
    } else if (v && typeof v === "object") { // old { m, t } single-slot -> one migrated cohort at their TWAB
      const o = v as { m?: number; t?: string };
      const units = bigOrZero(o?.t);
      if (units > BigInt(0)) prevState[w] = [{ units, months: Math.max(0, Math.floor(o?.m ?? 0)) }];
    } // plain-number (ancient) or empty -> start fresh
  }

  const sums: Record<string, bigint> = {};
  for (const [w, v] of Object.entries(store.bal ?? {})) { try { sums[w] = BigInt(v); } catch { /* skip bad */ } }
  const obs: EpochObservation = { runs: store.runs ?? 0, sums };

  const release = dripForMonth(MISFITZ_TOKEN.lpRewardUnits, opts.dripMonth, LP_REWARD_RATE_BPS).drip;
  const { result, nextState } = rollLpEpoch(obs, prevState, release, { advanceTenure: opts.advanceTenure, excluded: lpExcludedWallets() });

  const topWallets = result.wallets.slice(0, LEADER_N).map((w) => w.wallet);
  const profiles = await resolveIdentities(topWallets).catch(() => new Map<string, { name: string | null; avatarUrl: string | null }>());
  const top: LpLeader[] = result.wallets.slice(0, LEADER_N).map((w) => {
    const id = profiles.get(w.wallet) ?? { name: null, avatarUrl: null };
    return { walletTrunc: truncWallet(w.wallet), name: id.name, avatarUrl: id.avatarUrl, lpUnits: w.twabUnits.toString(), monthsHeld: w.monthsHeld, multiplier: w.multiplier, tokenUnits: w.tokenUnits.toString() };
  });

  const dto: LpSnapshotDTO = {
    v: 1, colId, epoch: opts.epoch, status: opts.status, computedAt, shadow: true,
    poolLive: Boolean(pair),
    pool: pair ? { liquidityAssetId: pair.liquidityAssetId, xchReserveMojos: pair.xchReserveMojos.toString(), tokenReserveUnits: pair.tokenReserveUnits.toString(), lpSupplyUnits: pair.lpSupplyUnits.toString() } : null,
    releaseUnits: release.toString(),
    distributedUnits: result.distributedUnits.toString(),
    holderCount: result.eligibleCount,
    top,
  };

  if (opts.advanceTenure) {
    const toStore: StateStore = {};
    for (const [w, cohorts] of Object.entries(nextState)) toStore[w] = cohorts.map((c) => ({ u: c.units.toString(), m: c.months }));
    // Persist tenure BEFORE the (guard-tripping) final snapshot; if it fails, abort so the month can retry.
    try { await cachePutLargeAsync(TEN_KEY(colId), JSON.stringify(toStore), EX_S); }
    catch { return { ok: false, status: "tenure-write-failed" }; }
  }
  await cachePutLargeAsync(SNAP_KEY(colId, opts.epoch), JSON.stringify(dto), EX_S);
  if (opts.updatePointer !== false) await cachePut(SNAP_PTR(colId), JSON.stringify({ epoch: opts.epoch }), EX_S);
  return { ok: true, status: pair ? opts.status : "pool-not-live" };
}

// Reads for the flag-gated /api/rewards/lp route.
async function latestEpoch(colId: string): Promise<string | null> {
  try { const ptr = await cacheGet(SNAP_PTR(colId), READ_TTL); if (ptr) return (JSON.parse(ptr) as { epoch: string }).epoch; } catch { /* none */ }
  return null;
}

export async function readLpSnapshot(colId: string): Promise<LpSnapshotDTO | null> {
  const epoch = await latestEpoch(colId);
  if (!epoch) return null;
  try { const raw = await cacheGetLarge(SNAP_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as LpSnapshotDTO) : null; } catch { return null; }
}

export async function readLpSnapshotFor(colId: string, epoch: string): Promise<LpSnapshotDTO | null> {
  try { const raw = await cacheGetLarge(SNAP_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as LpSnapshotDTO) : null; } catch { return null; }
}

export function lpMultiplierFor(months: number): number { return tenureMultiplier(months); }
