// MisFitz Rewards — SHADOW snapshot compute job (SERVER-ONLY, network). Runs the whole monthly pipeline and
// persists ONE public snapshot blob + a private per-wallet lookup map to Redis. NEVER runs on a page view — a
// cron calls this. Flag-gated. Moves no funds. Substitute for the `server-only` package (not installed): a
// runtime guard so this can never execute in a browser bundle.
if (typeof window !== "undefined") throw new Error("snapshotJob is server-only");

import { fetchDexieEpochSales, attributeCounterparties, resolveFvLookup, fetchActiveListings } from "./detectLive";
import { buildEpochInputs, type RawSale } from "./detect";
import { computeEpoch } from "./engine";
import { settleUnattributed, assertSettlementSolvent } from "./settle";
import { operatorPlanFromSettlement } from "./operator";
import { allocateDrip, weighHoldings, type SnapshotNft } from "./allocator";
import { dripForMonth, MISFITZ_TOKEN } from "./token";
import { toSnapshotDTO, toOperatorDTO, leaderboardWallets, buildWalletMap, type ProfileMap } from "./snapshotSerialize";
import { buildSettlementDoc, type SettlementDoc } from "./settlementDoc";
import { resolveIdentities } from "./identity";
import { isRewardsShadowEnabled } from "./flag";
import { cacheGet, cachePut, cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { getSeed, numberFromName } from "@/lib/data-sources/seed/registry";
import type { SnapshotDTO, OperatorSnapshotDTO, WalletLookupValue } from "./snapshotTypes";
import type { MgListItem } from "@/lib/data-sources/mintgarden/types";

const EX_S = 60 * 24 * 60 * 60;                 // keep snapshot/wallet blobs 60 days
const READ_TTL = 45 * 24 * 60 * 60_000;         // read-fresh window for the pointer/blobs
const ATTRIB_TTL_MS = 40 * 24 * 60 * 60_000;
const SLIMLIST_TTL_MS = 30 * 24 * 60 * 60_000;

const SNAP_KEY = (c: string, e: string) => `rw:snap:v1:${c}:${e}`;
const SNAP_PTR = (c: string) => `rw:snap:latest:${c}`;
const WALLETS_KEY = (c: string, e: string) => `rw:wallets:v1:${c}:${e}`;
const OPS_KEY = (c: string, e: string) => `rw:ops:v1:${c}:${e}`;   // operator-only blob (served by the authed route)
const SETTLE_KEY = (c: string, e: string) => `rw:settledoc:v1:${c}:${e}`; // operator-only combined settlement document
const ATTRIB_KEY = (c: string, e: string) => `rw:attrib:${c}:${e}`;

// Incremental attribution: only fetch MintGarden events for offerIds we haven't attributed this epoch. Keeps the
// daily cron cost proportional to NEW sales, not the whole month re-fetched every run (fable must-do #5).
async function attributeIncremental(colId: string, epoch: string, raws: RawSale[]): Promise<void> {
  const key = ATTRIB_KEY(colId, epoch);
  let cache: Record<string, { buyer: string | null; seller: string | null }> = {};
  try { const raw = await cacheGet(key, ATTRIB_TTL_MS); if (raw) cache = JSON.parse(raw); } catch { /* start fresh */ }
  const need = raws.filter((r) => !(r.offerId in cache));
  if (need.length) {
    await attributeCounterparties(need, { fresh: true }); // fresh: skip stale cached event logs; background-paced
    let wrote = false;
    for (const r of need) if (r.buyer || r.seller) { cache[r.offerId] = { buyer: r.buyer ?? null, seller: r.seller ?? null }; wrote = true; } // cache ONLY resolved -> misses retry next run
    if (wrote) try { await cachePut(key, JSON.stringify(cache), ATTRIB_TTL_MS / 1000); } catch { /* best effort */ }
  }
  for (const r of raws) { const c = cache[r.offerId]; if (c) { r.buyer = c.buyer; r.seller = c.seller; } }
}

// Current holders from the warmed roster blob (owner + rank), a single Redis read — no 100-page MintGarden scan.
// NOTE (shadow): the roster's owners are as fresh as the last roster scan, so this is an APPROXIMATE holder
// snapshot; a deterministic block snapshot is the pre-launch upgrade (spec §7). Returns truncated=true if the
// roster isn't warmed yet.
async function rosterFromCache(colId: string): Promise<{ holders: SnapshotNft[]; truncated: boolean }> {
  const seed = await getSeed(colId).catch(() => null);
  let raw: string | null = null;
  try { raw = await cacheGetLarge(`slimlist2:${colId}`, SLIMLIST_TTL_MS); } catch { raw = null; }
  if (!raw) return { holders: [], truncated: true };
  let items: MgListItem[] = [];
  let capped = false;
  try { const p = JSON.parse(raw) as { items?: MgListItem[]; capped?: boolean }; items = p.items ?? []; capped = Boolean(p.capped); } catch { return { holders: [], truncated: true }; }
  const supply = seed ? Object.keys(seed.byNumber).length : items.length;
  const holders: SnapshotNft[] = [];
  for (const it of items) {
    const wallet = it.owner_address_encoded_id ?? null;
    if (!wallet) continue;
    let rank: number | null = null;
    const num = numberFromName(it.name ?? "");
    if (seed && num != null) rank = seed.byNumber[String(num)]?.rank ?? null;
    if (rank == null) { const r = Number(it.openrarity_rank); rank = Number.isFinite(r) && r > 0 ? r : null; }
    holders.push({ wallet, rank, supply });
  }
  return { holders, truncated: capped || holders.length === 0 };
}

export interface ComputeOpts { epochStart: number; epochEnd: number; epoch: string; status: "mtd" | "final"; dripMonth: number; updatePointer?: boolean }

// Compute + persist the snapshot for one epoch. Returns a small status. No-op (and writes nothing) when the flag
// is off — defense in depth on top of the cron's own gate.
export async function computeRewardsSnapshot(colId: string, opts: ComputeOpts): Promise<{ ok: boolean; status: string }> {
  if (!isRewardsShadowEnabled()) return { ok: false, status: "disabled" };

  // Trader side
  const raws = await fetchDexieEpochSales(colId, opts.epochStart, opts.epochEnd);
  await attributeIncremental(colId, opts.epoch, raws);
  const [fv, listings] = await Promise.all([resolveFvLookup(colId, raws, { persist: true }), fetchActiveListings(colId)]);
  // A FINAL run is write-once. If the valuation model is DOWN and there are sales to tag, don't freeze everyone
  // as "none" forever — skip and let the next day's attempt (we have two days) retry with a warm model.
  if (opts.status === "final" && !fv.compsAvailable && raws.some((r) => fv.fvOf(r) == null)) return { ok: false, status: "defer-final-no-comps" };
  const { sales, signals } = buildEpochInputs(raws, opts.epochStart, opts.epochEnd, fv.fvOf, listings);
  const payoutAt = Math.max(Date.now(), opts.epochEnd);
  const epochResult = computeEpoch(sales, signals, opts.epochStart, opts.epochEnd, undefined, payoutAt);
  const settlement = settleUnattributed(epochResult);
  assertSettlementSolvent(epochResult, settlement); // never publish/act on an insolvent split
  const operator = operatorPlanFromSettlement(epochResult, settlement);

  // Holder side (roster from cache)
  const { holders, truncated } = await rosterFromCache(colId);
  // Don't overwrite a good snapshot with a bogus one: if the roster isn't available at all, a "drip over 0
  // holders" is nonsense — skip the write so the last good snapshot (or pending) stands.
  if (truncated && holders.length === 0) return { ok: false, status: "roster-missing" };
  const { drip: dripUnits } = dripForMonth(MISFITZ_TOKEN.dripPoolUnits, opts.dripMonth, MISFITZ_TOKEN.dripRateBps);
  const drip = allocateDrip(weighHoldings(holders), dripUnits);

  // Resolve public identities (name + pfp) for ONLY the leaderboard wallets — a couple dozen, Redis-cached.
  // Tolerant: a resolver failure just means truncated addresses (never blocks the snapshot).
  const { traders: leaderTraders, holders: leaderHolders } = leaderboardWallets(settlement, drip);
  const profiles = await resolveIdentities([...leaderTraders, ...leaderHolders]).catch((): ProfileMap => new Map());

  // Serialize + persist. PUBLIC snapshot (no operator) + private wallet map + operator-only blob. The pointer
  // moves only when updatePointer !== false.
  const computedAt = Date.now();
  const dto = toSnapshotDTO({ colId, epoch: opts.epoch, status: opts.status, computedAt, epochResult, settlement, drip, truncated, profiles });
  const opsDto = toOperatorDTO({ colId, epoch: opts.epoch, status: opts.status, computedAt, operator });
  const walletMap = buildWalletMap(drip, settlement);
  // Operator-only combined settlement document (XCH move breakdown + $CHIPS drip + per-wallet table + hash).
  // Served by the authed /api/rewards/manifest route. $CHIPS asset id defaults to the placeholder until minted.
  const settleDoc = buildSettlementDoc({
    collectionId: colId, epochId: opts.epoch, status: opts.status, generatedAt: computedAt, truncated,
    epochResult, settlement, operator, drip,
    tokenAssetId: process.env.CHIPS_ASSET_ID || undefined,
  });
  await cachePutLargeAsync(SETTLE_KEY(colId, opts.epoch), JSON.stringify(settleDoc), EX_S);
  await cachePutLargeAsync(SNAP_KEY(colId, opts.epoch), JSON.stringify(dto), EX_S);
  await cachePutLargeAsync(WALLETS_KEY(colId, opts.epoch), JSON.stringify(walletMap), EX_S);
  await cachePut(OPS_KEY(colId, opts.epoch), JSON.stringify(opsDto), EX_S); // small — plain SET
  if (opts.updatePointer !== false) await cachePut(SNAP_PTR(colId), JSON.stringify({ epoch: opts.epoch }), EX_S);
  return { ok: true, status: truncated ? "partial" : opts.status };
}

// ── Reads (used by the flag-gated read APIs) ────────────────────────────────────
async function latestEpoch(colId: string): Promise<string | null> {
  try { const ptr = await cacheGet(SNAP_PTR(colId), READ_TTL); if (ptr) return (JSON.parse(ptr) as { epoch: string }).epoch; } catch { /* none */ }
  return null;
}

export async function readSnapshotFor(colId: string, epoch: string): Promise<SnapshotDTO | null> {
  try { const raw = await cacheGetLarge(SNAP_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as SnapshotDTO) : null; } catch { return null; }
}

export async function readSnapshot(colId: string): Promise<SnapshotDTO | null> {
  const epoch = await latestEpoch(colId);
  if (!epoch) return null;
  try { const raw = await cacheGetLarge(SNAP_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as SnapshotDTO) : null; } catch { return null; }
}

// Operator-only read (served by the AUTHED /api/rewards/operator route — never the public snapshot route).
export async function readOperator(colId: string): Promise<OperatorSnapshotDTO | null> {
  const epoch = await latestEpoch(colId);
  if (!epoch) return null;
  try { const raw = await cacheGet(OPS_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as OperatorSnapshotDTO) : null; } catch { return null; }
}

// Operator-only read of the combined settlement document for a specific epoch (served by the authed
// /api/rewards/manifest route). Reads a specific epoch (not the pointer) so a closed final epoch's doc can be
// downloaded even after the MTD pointer has moved on to the next month.
export async function readSettlementDoc(colId: string, epoch: string): Promise<SettlementDoc | null> {
  try { const raw = await cacheGetLarge(SETTLE_KEY(colId, epoch), READ_TTL); return raw ? (JSON.parse(raw) as SettlementDoc) : null; } catch { return null; }
}

export async function latestEpochId(colId: string): Promise<string | null> {
  return latestEpoch(colId);
}

export async function readWalletValue(colId: string, wallet: string): Promise<WalletLookupValue | null> {
  const epoch = await latestEpoch(colId);
  if (!epoch) return null;
  try {
    const raw = await cacheGetLarge(WALLETS_KEY(colId, epoch), READ_TTL);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, WalletLookupValue>;
    return map[wallet] ?? null;
  } catch { return null; }
}
