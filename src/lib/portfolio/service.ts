import type { NftData } from "@/types";
import { fetchOwnerNftDetails } from "@/lib/data-sources/mintgarden/owner";
import { mapDetailToNftData } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, XCH_USD_FALLBACK } from "@/lib/market/dexie";

// The no-login "what's my wallet worth" service (ARCHITECTURE.md Product Vision / Two entry
// paths). Pulls an address's live holdings from MintGarden, attaches our fair-value estimate, and
// groups by collection with running totals. No account, no DB writes — purely a read-and-value.

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

  const byCol = new Map<string, PortfolioGroup>();
  for (const d of details) {
    const m = mapDetailToNftData(d, xchUsdRate);
    let group = byCol.get(m.collectionId);
    if (!group) {
      group = {
        collectionId: m.collectionId,
        collectionName: m.collectionName,
        floorXch: m.collectionFloorXch,
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
