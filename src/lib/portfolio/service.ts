import type { NftData } from "@/types";
import { fetchOwnerNftDetails } from "@/lib/data-sources/mintgarden/owner";
import { mapDetailToNftData, nftMarketAnchorXch, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { getCollectionFrequency } from "@/lib/rarity/collectionFrequency";
import { getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionListingCount, fetchCollectionSaleFloor, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { valueRange, type Confidence } from "@/lib/valuation/range";
import { estimateFairValue } from "@/lib/valuation/estimate";
import { getCompsModel } from "@/lib/valuation/compsService";
import { isCompsEnabled } from "@/lib/config";
import { cacheGet, cachePut } from "@/lib/db/nftCache";
import { isSeeded, getSeed, numberFromName } from "@/lib/data-sources/seed/registry";

// The no-login "what's my wallet worth" service (ARCHITECTURE.md Product Vision / VALUATION.md).
// Pulls an address's live holdings from MintGarden, values each NFT, groups by collection, and
// attaches a per-collection confidence + range driven by how liquid that collection is. No account,
// no DB writes. Floor prefers live Dexie, falling back to MintGarden.

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export interface PortfolioNft {
  nft: NftData;
  collectionName: string;
  totalSupply: number;
}

export interface PortfolioGroup {
  collectionId: string;
  collectionName: string;
  floorXch: number | null;
  floorSource: "dexie" | "mintgarden" | "dexie-sales" | "holdings" | "none";
  items: PortfolioNft[];
  estimateXch: number; // point estimate (sum of fair-value estimates)
  low: number; // range floor for this collection's estimate
  high: number; // range ceiling
  confidence: Confidence; // driven by this collection's liquidity (active listings + recent sales)
  listedXch: number;
  listedCount: number;
}

export interface Portfolio {
  address: string;
  xchUsdRate: number;
  groups: PortfolioGroup[];
  totalCount: number;
  totalEstimateXch: number;
  totalEstimateUsd: number;
  totalLowXch: number;
  totalHighXch: number;
  confidence: Confidence; // a portfolio is only as trustworthy as its least-liquid holding
  truncated: boolean;
}

const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

// Cache the ASSEMBLED portfolio per address (short TTL): a reload, a saved-wallet re-open, or two people
// viewing the same wallet all share one build instead of re-fetching 120 NFT details every time.
const PORTFOLIO_TTL_MS = 5 * 60_000;

export async function getAddressPortfolio(address: string): Promise<Portfolio> {
  const cacheKey = `portfolio2:${address.trim().toLowerCase()}`;
  try { const hit = await cacheGet(cacheKey, PORTFOLIO_TTL_MS); if (hit) return JSON.parse(hit) as Portfolio; } catch { /* miss -> build */ }
  const [{ details, truncated }, rate] = await Promise.all([
    fetchOwnerNftDetails(address),
    fetchXchUsdRate(),
  ]);
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;

  // Under load MintGarden can return a partial/odd holding (e.g. a detail with no collection). Drop those
  // so one bad entry can never crash the whole portfolio view — we value what we can and skip the rest.
  const usable = details.filter((d) => d && d.collection && typeof d.collection.id === "string" && d.collection.id.length > 0);

  // Resolve one floor per collection: live Dexie ask first, MintGarden floor_price as fallback.
  const mgFloorByCol = new Map<string, number | null>();
  for (const d of usable) {
    if (!mgFloorByCol.has(d.collection.id)) {
      mgFloorByCol.set(
        d.collection.id,
        typeof d.collection.floor_price === "number" ? d.collection.floor_price : null,
      );
    }
  }
  const colIds = Array.from(mgFloorByCol.keys());
  const [dexieFloors, listingCounts, saleFloors] = await Promise.all([
    Promise.all(colIds.map((id) => fetchCollectionFloor(id).catch(() => null))),
    Promise.all(colIds.map((id) => fetchCollectionListingCount(id).catch(() => 0))),
    Promise.all(colIds.map((id) => fetchCollectionSaleFloor(id).catch(() => null))),
  ]);

  // Holdings-derived floor: when the market gives us nothing, anchor on the cheapest price signal
  // (recent sale / current ask) seen among the cards we DO hold from that collection. Wallet-relative,
  // but it keeps every card in a collection on one consistent base instead of pricing each off its own
  // sale. Superseded by a real collection floor as soon as one exists (job #39).
  const anchorsByCol = new Map<string, number[]>();
  for (const d of usable) {
    const a = nftMarketAnchorXch(d);
    if (a !== null) {
      const arr = anchorsByCol.get(d.collection.id) ?? [];
      arr.push(a);
      anchorsByCol.set(d.collection.id, arr);
    }
  }

  const floorByCol = new Map<string, { floor: number | null; source: PortfolioGroup["floorSource"] }>();
  const listingsByCol = new Map<string, number>();
  colIds.forEach((id, i) => {
    listingsByCol.set(id, listingCounts[i] ?? 0);
    const dexie = dexieFloors[i];
    const mg = mgFloorByCol.get(id) ?? null;
    const sale = saleFloors[i];
    const anchors = anchorsByCol.get(id) ?? [];
    const holdingFloor = anchors.length ? Math.min(...anchors) : null;
    // Precedence: live ask → MintGarden floor → recent Dexie sales → cheapest signal among holdings.
    if (typeof dexie === "number") floorByCol.set(id, { floor: dexie, source: "dexie" });
    else if (mg !== null) floorByCol.set(id, { floor: mg, source: "mintgarden" });
    else if (typeof sale === "number") floorByCol.set(id, { floor: sale, source: "dexie-sales" });
    else if (holdingFloor !== null) floorByCol.set(id, { floor: holdingFloor, source: "holdings" });
    else floorByCol.set(id, { floor: null, source: "none" });
  });

  const byCol = new Map<string, PortfolioGroup>();
  for (const d of usable) {
    const resolved = floorByCol.get(d.collection.id) ?? { floor: null, source: "none" as const };
    const m = mapDetailToNftData(d, xchUsdRate, resolved.floor);
    let group = byCol.get(m.collectionId);
    if (!group) {
      group = {
        collectionId: m.collectionId,
        collectionName: m.collectionName,
        floorXch: resolved.floor,
        floorSource: resolved.source,
        items: [],
        estimateXch: 0,
        low: 0,
        high: 0,
        confidence: "low",
        listedXch: 0,
        listedCount: 0,
      };
      byCol.set(m.collectionId, group);
    }
    group.items.push({ nft: m.nft, collectionName: m.collectionName, totalSupply: m.totalSupply });
    group.estimateXch += m.nft.fairValue?.totalEstimate ?? 0;
    if (m.nft.listing) {
      group.listedXch += m.nft.listing.priceXch;
      group.listedCount += 1;
    }
  }

  const groups = Array.from(byCol.values()).sort((a, b) => b.estimateXch - a.estimateXch);

  // Per-collection confidence + range. recentSales = 0 until the sales-history feed exists, so the
  // ceiling today is "medium" (≥3 active listings) — honestly capped.
  let confidence: Confidence = groups.length ? "high" : "low";
  for (const g of groups) {
    g.estimateXch = round(g.estimateXch);
    g.listedXch = round(g.listedXch);
    const r = valueRange(g.estimateXch, { activeListings: listingsByCol.get(g.collectionId) ?? 0, recentSales: 0 });
    g.low = r.low;
    g.high = r.high;
    g.confidence = r.confidence;
    if (CONF_RANK[g.confidence] < CONF_RANK[confidence]) confidence = g.confidence;
  }

  const totalEstimateXch = round(groups.reduce((s, g) => s + g.estimateXch, 0));
  const totalLowXch = round(groups.reduce((s, g) => s + g.low, 0));
  const totalHighXch = round(groups.reduce((s, g) => s + g.high, 0));
  const totalCount = groups.reduce((s, g) => s + g.items.length, 0);

  const result: Portfolio = {
    address,
    xchUsdRate,
    groups,
    totalCount,
    totalEstimateUsd: round(totalEstimateXch * xchUsdRate),
    totalEstimateXch,
    totalLowXch,
    totalHighXch,
    confidence,
    truncated,
  };
  try { if (result.totalCount > 0) cachePut(cacheKey, JSON.stringify(result)); } catch { /* cache optional */ }
  return result;
}

// Enrich a specific set of NFTs (by launcher id) for the progressive binder's BATCHED loading: fetch
// each detail (cached) and map it with the collection floor the fast path already resolved, so values
// stay stable while traits + our estimated ranks fill in. Returns only the NFTs that mapped cleanly.
export async function enrichNftsByIds(
  ids: string[],
  floorByCollection: Record<string, number>,
  xchUsdRate: number,
): Promise<NftData[]> {
  // small bounded-concurrency pool
  const details = new Array<Awaited<ReturnType<typeof getNftDetail>> | null>(ids.length);
  let next = 0;
  const LIMIT = 12;
  await Promise.all(
    Array.from({ length: Math.min(LIMIT, ids.length) }, async () => {
      while (next < ids.length) {
        const i = next++;
        try { details[i] = await getNftDetail(ids[i]); } catch { details[i] = null; }
      }
    }),
  );

  // For collections MintGarden hasn't ranked (no attributes_frequency_counts) but whose NFTs carry
  // traits, inject OUR OWN computed frequency table so the rank estimator + trait-rarity math can run.
  // Non-blocking: uses the cached table if warm, else kicks a background build and skips this pass.
  const needFreq = [...new Set(
    details
      .filter((d): d is NonNullable<typeof d> => !!d && !d.collection?.attributes_frequency_counts && !!d.collection?.id?.startsWith("col1") && !isSeeded(d.collection.id))
      .map((d) => d.collection.id),
  )];
  const freqByCol = new Map<string, Record<string, Record<string, number>>>();
  if (needFreq.length > 0) {
    const results = await Promise.all(needFreq.map((c) => getCollectionFrequency(c).catch(() => null)));
    needFreq.forEach((c, i) => { const r = results[i]; if (r) freqByCol.set(c, r.freq); });
  }

  // Seeded collections: our bundled OpenRarity ranks + traits are authoritative. Fetch the seed(s) once
  // and OVERRIDE MintGarden's (unranked) rank/traits per card by mint number — so enrichment confirms the
  // fast-path overlay instead of clobbering it, and wallet numbers match the collection page exactly.
  const seedCols = [...new Set(details.filter((d): d is NonNullable<typeof d> => !!d && isSeeded(d.collection?.id ?? "")).map((d) => d.collection.id))];
  const seedByCol = new Map(await Promise.all(seedCols.map(async (c) => [c, await getSeed(c).catch(() => null)] as const)));
  const seedPct = new Map<string, (t: string, v: string) => number>();
  for (const [c, seed] of seedByCol) {
    if (!seed) continue;
    const tf = new Map<string, number>();
    for (const key in seed.byNumber) for (const [t, v] of seed.byNumber[key].traits) { const kk = `${t}|${v}`; tf.set(kk, (tf.get(kk) ?? 0) + 1); }
    seedPct.set(c, (t, v) => Math.round(((tf.get(`${t}|${v}`) ?? 0) / seed.supply) * 10000) / 100);
  }

  const out: NftData[] = [];
  const outCol: string[] = []; // collection (col1...) per out card, for the comps blend
  for (const d of details) {
    if (!d || !isDisplayableNft(d)) continue;
    const colId = d.collection.id;
    if (!d.collection.attributes_frequency_counts && freqByCol.has(colId)) {
      d.collection.attributes_frequency_counts = freqByCol.get(colId)!; // our own table -> estimated ranks + trait rarity
    }
    const floor = floorByCollection[colId];
    const m = mapDetailToNftData(d, xchUsdRate, typeof floor === "number" ? floor : null);
    const card: NftData = { ...m.nft, totalSupply: m.totalSupply, collectionName: m.collectionName };
    const seed = seedByCol.get(colId);
    if (seed) {
      const num = numberFromName(card.name); // card.name is the mapped display name ("Misfitz #3663"); raw d.name is a different field
      const e = num != null ? seed.byNumber[String(num)] : undefined;
      if (e) {
        const pct = seedPct.get(colId)!;
        card.rarityRank = e.rank;
        card.rankEstimated = false;
        card.totalSupply = seed.supply;
        card.traits = e.traits.map(([trait_type, value]) => ({ trait_type, value, rarityPercent: pct(trait_type, value) }));
        // Recompute the baseline value with the SEED rank (MintGarden gave this NFT no rank, so its
        // fairValue was null/wrong). Without this the comps blend below is skipped (guarded on fairValue)
        // and the wallet shows a bad/absent value. Mirrors buildBaseCollection + the fast-path overlay.
        const seedFloor = floorByCollection[colId];
        if (typeof seedFloor === "number") {
          card.fairValue = estimateFairValue({ floorXch: seedFloor, rarityRank: e.rank, totalSupply: seed.supply, xchUsdRate }) ?? card.fairValue;
        }
      }
    }
    out.push(card);
    outCol.push(colId);
  }

  // Trait-aware comparable-sales blend. Now that each card has its real traits, the comps model can
  // apply per-trait premiums on top of the rank curve (e.g. a coveted Body trait). One cached model
  // per collection; thin evidence (low confidence) leaves the existing estimate essentially untouched.
  if (isCompsEnabled() && out.length > 0) {
    const cols = [...new Set(outCol)].filter((c) => c.startsWith("col1"));
    const models = new Map(await Promise.all(cols.map(async (c) => [c, await getCompsModel(c).catch(() => null)] as const)));
    for (let i = 0; i < out.length; i++) {
      const model = models.get(outCol[i]);
      const card = out[i];
      if (!model || card.rarityRank == null || !card.fairValue) continue;
      const traits = card.traits?.map((t) => ({ k: t.trait_type, v: String(t.value) }));
      const cv = model.valueOf(card.rarityRank, traits);
      if (cv.value == null) continue;
      const floor = floorByCollection[outCol[i]];
      const numberWeight = typeof floor === "number" && floor > 0 ? Math.max(0, (card.fairValue.desirabilityPremium ?? 0) / floor) : 0;
      const collectorMult = 1 + numberWeight; // collector number is multiplicative on the curve price
      const total = round(Math.max(typeof floor === "number" ? floor : 0, cv.value * collectorMult), 3);
      card.fairValue = { ...card.fairValue, totalEstimate: total, totalEstimateUsd: round(total * xchUsdRate, 2) };
      card.valueBasis = cv.basis;
      card.valueConfidence = round(cv.confidence, 2);
      card.valueSampleSize = model.sampleSize;
      card.valueCurve = cv.curve != null ? round(cv.curve, 3) : null;
      card.valueTraitMult = round(cv.traitMult, 3);
      card.valueTraitTop = cv.traitTop ?? null;
    }
  }
  return out;
}
