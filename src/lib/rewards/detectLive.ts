// MisFitz Rewards — the LIVE detection bridge (network I/O). This is the ONE rewards file allowed to import
// the app data layer (Dexie sales, MintGarden events, the comps model). It's kept SEPARATE from detect.ts so
// the pure mapping stays unit-testable without dragging the heavy app graph into the test loader. Still
// imported by NOTHING in the live app and moves ZERO funds / touches ZERO keys — it only assembles inputs for
// the pure engine so a SHADOW epoch can run on real sales.
//
// Operator-confirmed decisions (MISFITZ-REWARDS.md §5):
//   • Source   — Dexie completed clean-XCH sales (status=4), not deduped: every sale in the window counts.
//   • Royalty  — TRUSTED from the marketplace record in shadow mode (royalty = 10% of price). On-chain
//                royalty-coin verification is a REQUIRED gate before any real payout (NOT built here).
//   • Deal tag — the bonus winner is APPROXIMATED from the current comps model FV at detection time.
//   • Provenance (coin/spend/block) is intentionally NOT set — that's the chain re-verification step required
//     before real payouts, not shadow mode.

import { getNftDetailsBatch, getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { getCompsModel } from "@/lib/valuation/compsService";
import { mapTraits } from "@/lib/data-sources/mintgarden/map";
import { getSeed, numberFromName } from "@/lib/data-sources/seed/registry";
import { computeEpoch } from "./engine";
import { buildEpochInputs, FINALITY_MS, type ActiveListing, type RawSale } from "./detect";
import { DEFAULT_CONFIG, type EpochResult, type RewardConfig } from "./types";

export { MISFITZ_COLLECTION_ID } from "./consts";
const DEXIE_BASE = "https://api.dexie.space/v1";

interface DexieCompletedOffer {
  id?: string;
  price?: number;
  date_completed?: string;
  date_found?: string;
  requested?: { code?: string; id?: string }[];
  offered?: { is_nft?: boolean; id?: string }[];
}

// Page Dexie's completed clean-XCH sales newest-first, keeping every sale whose completion time is in the
// window. Stops as soon as a whole page predates `start`. NOT deduped — an NFT that sold twice yields two rows.
export async function fetchDexieEpochSales(colId: string, start: number, end: number, maxPages = 40): Promise<RawSale[]> {
  const out: RawSale[] = [];
  const seen = new Set<string>(); // dedupe: live pagination can shift a row across page boundaries (double-count)
  const lo = start - FINALITY_MS; // fetch the finality-shifted window so rolled-over sales aren't missed
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`${DEXIE_BASE}/offers`);
    url.searchParams.set("status", "4");
    url.searchParams.set("offered", colId);
    url.searchParams.set("requested", "xch");
    url.searchParams.set("sort", "date_completed");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", "100");
    let offers: DexieCompletedOffer[] = [];
    try {
      const res = await fetch(url.toString());
      if (!res.ok) { console.warn(`[rewards] Dexie sales page ${page} for ${colId} returned ${res.status} — epoch may be INCOMPLETE.`); break; }
      const json = (await res.json()) as { offers?: DexieCompletedOffer[] };
      offers = json?.offers ?? [];
    } catch (e) { console.warn(`[rewards] Dexie sales fetch failed on page ${page} for ${colId} — epoch may be INCOMPLETE.`, e); break; }
    if (offers.length === 0) break;
    let pageOldest = Infinity;
    for (const o of offers) {
      const req = o.requested ?? [];
      const offered = o.offered ?? [];
      const xchOnly = req.length === 1 && (req[0].code ?? req[0].id ?? "").toLowerCase() === "xch";
      const nfts = offered.filter((x) => x.is_nft && x.id);
      // Clean single-NFT XCH sale ONLY: exactly one offered item that is that NFT (offered.length===1 rejects
      // NFT+CAT bundles that would otherwise pass as a clean XCH sale and mis-price it).
      if (!xchOnly || nfts.length !== 1 || offered.length !== 1 || typeof o.price !== "number" || o.price <= 0) continue;
      const at = new Date(o.date_completed || o.date_found || 0).getTime();
      if (!Number.isFinite(at) || at <= 0) continue;
      pageOldest = Math.min(pageOldest, at);
      if (at < lo || at > end) continue;
      const offerId = o.id || `${nfts[0].id}:${at}`;
      if (seen.has(offerId)) continue; // pagination dupe
      seen.add(offerId);
      out.push({ offerId, nftId: nfts[0].id as string, priceXch: o.price, soldAt: at });
    }
    if (pageOldest < lo) break; // pages are newest-first; once a whole page predates the window we're done
    if (page === maxPages && pageOldest >= lo) {
      console.warn(`[rewards] fetchDexieEpochSales hit page cap (${maxPages}) for ${colId} without reaching the window start — epoch may be TRUNCATED (undercount).`);
    }
  }
  return out;
}

// Fill buyer/seller on each raw sale from the NFT's MintGarden sale events, matched by price (events carry the
// counterparties but no timestamp in our mapping, so we match on the XCH price and consume each event once).
// Unmatched sales keep their placeholder wallet.
export async function attributeCounterparties(raws: RawSale[], opts: { fresh?: boolean } = {}): Promise<void> {
  const ids = [...new Set(raws.map((r) => r.nftId))];
  if (ids.length === 0) return;
  // fresh=true skips the cache: a detail cached BEFORE the NFT sold has no event for the new sale, which would
  // mis-route the reward. Fetch those fresh (background-paced). Non-fresh callers use the cheap batched read.
  const details = opts.fresh
    ? await Promise.all(ids.map((id) => getNftDetail(id, true, false, true).catch(() => null)))
    : await getNftDetailsBatch(ids, true).catch(() => []);
  const byId = new Map<string, { priceXch: number; buyer: string | null; seller: string | null }[]>();
  for (const d of details) {
    if (!d) continue;
    const events = (d.events ?? []).filter((e) => e && e.type === 2 && typeof e.xch_price === "number" && (e.xch_price ?? 0) > 0);
    byId.set(d.encoded_id, events.map((e) => ({
      priceXch: e.xch_price as number,
      buyer: e.address?.encoded_id ?? null,
      seller: e.previous_address?.encoded_id ?? null,
    })));
  }
  for (const raw of raws) {
    const evs = byId.get(raw.nftId);
    if (!evs || evs.length === 0) continue;
    let bestIdx = -1, bestDiff = Infinity;
    for (let i = 0; i < evs.length; i++) {
      const diff = Math.abs(evs[i].priceXch - raw.priceXch);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    // Only accept a price-match within tolerance (~0.5% or 0.05 XCH). Events carry no timestamp in our mapping,
    // so a loose match could pin an ancient unrelated sale (truncated event log) onto this month's reward and
    // pay the wrong wallet. Outside tolerance we KEEP the placeholder — on-chain verification (pre-payout gate)
    // is the real attribution source.
    const tol = Math.max(0.05, raw.priceXch * 0.005);
    if (bestIdx >= 0 && bestDiff <= tol) { raw.buyer = evs[bestIdx].buyer; raw.seller = evs[bestIdx].seller; evs.splice(bestIdx, 1); } // consume once
  }
}

// Build a frozen-FV lookup for the sold NFTs from the current comps model (approximation, per the decision).
// MisFitz is seeded, so rank comes from the seed by mint number; FV = comps.valueOf(rank). null when we can't
// value it (no comps / no rank) -> that sale simply earns no deal bonus.
export async function buildFvLookup(colId: string, raws: RawSale[]): Promise<(r: RawSale) => number | null> {
  const [comps, seed] = await Promise.all([getCompsModel(colId).catch(() => null), getSeed(colId).catch(() => null)]);
  if (!comps) return () => null;
  const ids = [...new Set(raws.map((r) => r.nftId))];
  const details = await getNftDetailsBatch(ids, true).catch(() => []); // background-paced (cron path)
  const fvById = new Map<string, number>();
  for (const d of details) {
    if (!d) continue;
    let rank: number | null = null;
    const num = numberFromName((d as { data?: { metadata_json?: { name?: string } } }).data?.metadata_json?.name ?? "");
    if (seed && num != null) rank = seed.byNumber[String(num)]?.rank ?? null;
    if (rank == null) { const r = Number(d.openrarity_rank); rank = Number.isFinite(r) && r > 0 ? r : null; }
    if (rank == null) continue;
    const traits = mapTraits(d).map((t) => ({ k: t.trait_type, v: String(t.value) }));
    const cv = comps.valueOf(rank, traits);
    if (cv.value != null) fvById.set(d.encoded_id, cv.value);
  }
  return (r: RawSale) => fvById.get(r.nftId) ?? null;
}

// Fetch active MisFitz Dexie listings as vest signals (listed-cheaper-than-purchase voids the buyer bonus).
export async function fetchActiveListings(colId: string): Promise<ActiveListing[]> {
  const now = Date.now();
  const out: ActiveListing[] = [];
  const url = new URL(`${DEXIE_BASE}/offers`);
  url.searchParams.set("status", "0"); // active
  url.searchParams.set("offered", colId);
  url.searchParams.set("requested", "xch");
  url.searchParams.set("sort", "price_asc");
  url.searchParams.set("page_size", "100");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return out;
    const json = (await res.json()) as { offers?: DexieCompletedOffer[] };
    for (const o of json?.offers ?? []) {
      const req = o.requested ?? [];
      const offered = o.offered ?? [];
      const xchOnly = req.length === 1 && (req[0].code ?? req[0].id ?? "").toLowerCase() === "xch";
      const nfts = offered.filter((x) => x.is_nft && x.id);
      if (!xchOnly || nfts.length !== 1 || offered.length !== 1 || typeof o.price !== "number" || o.price <= 0) continue;
      out.push({ nftId: nfts[0].id as string, priceXch: o.price, at: now });
    }
  } catch { /* best effort */ }
  return out;
}

// Full SHADOW epoch on real MisFitz data: detect -> attribute -> freeze tags -> run the pure engine. Moves no
// funds; produces the same EpochResult the reports/dashboard consume. This is the demonstrable end-to-end.
export async function runShadowEpoch(
  colId: string,
  epochStart: number,
  epochEnd: number,
  cfg: RewardConfig = DEFAULT_CONFIG,
): Promise<EpochResult> {
  const raws = await fetchDexieEpochSales(colId, epochStart, epochEnd);
  await attributeCounterparties(raws);
  const [fvLookup, listings] = await Promise.all([buildFvLookup(colId, raws), fetchActiveListings(colId)]);
  const { sales, signals } = buildEpochInputs(raws, epochStart, epochEnd, fvLookup, listings);
  // payoutAt = now for a retro run (epochEnd in the past), else epochEnd. Otherwise every "listed cheaper"
  // signal (stamped at now) is discarded as after-payout and bonuses wrongly vest in retro shadow reports.
  const payoutAt = Math.max(Date.now(), epochEnd);
  return computeEpoch(sales, signals, epochStart, epochEnd, cfg, payoutAt);
}
