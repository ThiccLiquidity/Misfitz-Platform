import type { NftData } from "@/types";
import { fetchOwnerNftDetails } from "@/lib/data-sources/mintgarden/owner";
import { mapDetailToNftData } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloor, fetchCollectionListingCount, XCH_USD_FALLBACK } from "@/lib/market/dexie";
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
  floorSource: "dexie" | "mintgarden" | "none";
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
  const [dexieFloors, listingCounts] = await Promise.all([
    Promise.all(colIds.map((id) => fetchCollectionFloor(id).catch(() => null))),
    Promise.all(colIds.map((id) => fetchCollectionListingCount(id).catch(() => 0))),
  ]);
  const floorByCol = new Map<string, { floor: number | null; source: PortfolioGroup["floorSource"] }>();
  const listingsByCol = new Map<string, number>();
  colIds.forEach((id, i) => {
    listingsByCol.set(id, listingCounts[i] ?? 0);
    const dexie = dexieFloors[i];
    if (typeof dexie === "number") floorByCol.set(id, { floor: dexie, source: "dexie" });
    else {
      const mg = mgFloorByCol.get(id) ?? null;
      floorByCol.set(id, { floor: mg, source: mg !== null ? "mintgarden" : "none" });
    }
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
