import type { NftData } from "@/types";
import { fetchOwnerNftDetails } from "@/lib/data-sources/mintgarden/owner";
import { mapDetailToNftData, nftMarketAnchorXch, isDisplayableNft } from "@/lib/data-sources/mintgarden/map";
import { getNftDetail } from "@/lib/data-sources/mintgarden/client";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionListingCount, fetchCollectionSaleFloor, XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { valueRange, type Confidence } from "@/lib/valuation/range";

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

export async function getAddressPortfolio(address: string): Promise<Portfolio> {
  const [{ details, truncated }, rate] = await Promise.all([
    fetchOwnerNftDetails(address),
    fetchXchUsdRate(),
  ]);
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;

  // Resolve one floor per collection: live Dexie ask first, MintGarden floor_price as fallback.
  const mgFloorByCol = new Map<string, number | null>();
  for (const d of details) {
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
  for (const d of details) {
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
  for (const d of details) {
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

  return {
    address,
    xchUsdRate,
    groups,
    totalCount,
    totalEstimateXch,
    totalEstimateUsd: round(totalEstimateXch * xchUsdRate),
    totalLowXch,
    totalHighXch,
    confidence,
    truncated,
  };
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

  const out: NftData[] = [];
  for (const d of details) {
    if (!d || !isDisplayableNft(d)) continue;
    const floor = floorByCollection[d.collection.id];
    const m = mapDetailToNftData(d, xchUsdRate, typeof floor === "number" ? floor : null);
    out.push({ ...m.nft, totalSupply: m.totalSupply, collectionName: m.collectionName });
  }
  return out;
}
