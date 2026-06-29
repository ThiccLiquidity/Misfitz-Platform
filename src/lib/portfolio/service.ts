import type { NftData } from "@/types";
import { fetchOwnerNftDetails } from "@/lib/data-sources/mintgarden/owner";
import { mapDetailToNftData } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloor, XCH_USD_FALLBACK } from "@/lib/market/dexie";

// The no-login "what's my wallet worth" service (ARCHITECTURE.md Product Vision / Two entry
// paths). Pulls an address's live holdings from MintGarden, attaches our fair-value estimate, and
// groups by collection with running totals. No account, no DB writes — purely a read-and-value.
//
// Floor source: we prefer the live Dexie floor (cheapest active ask) per collection and fall back
// to MintGarden's stored floor_price when Dexie has none — Dexie is the designated market source.

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
  estimateXch: number; // sum of our fair-value estimates
  listedXch: number; // sum of active listing asks in this group
  listedCount: number;
}

export interface Portfolio {
  address: string;
  xchUsdRate: number;
  groups: PortfolioGroup[];
  totalCount: number;
  totalEstimateXch: number;
  totalEstimateUsd: number;
  truncated: boolean; // address holds more NFTs than we fetched (see MAX_HOLDINGS)
}

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
  const dexieFloors = await Promise.all(
    colIds.map((id) => fetchCollectionFloor(id).catch(() => null)),
  );
  const floorByCol = new Map<string, { floor: number | null; source: PortfolioGroup["floorSource"] }>();
  colIds.forEach((id, i) => {
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
  for (const g of groups) {
    g.estimateXch = round(g.estimateXch);
    g.listedXch = round(g.listedXch);
  }

  const totalEstimateXch = round(groups.reduce((sum, g) => sum + g.estimateXch, 0));
  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);

  return {
    address,
    xchUsdRate,
    groups,
    totalCount,
    totalEstimateXch,
    totalEstimateUsd: round(totalEstimateXch * xchUsdRate),
    truncated,
  };
}
