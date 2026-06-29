import type { NftData } from "@/types";
import { getAddressPortfolio } from "./service";
import { getCollectionBySlug, listNftsForCollection } from "@/lib/db/queries";
import { enrichNfts } from "@/lib/rarity/enrich";
import { fetchMarketContext, XCH_USD_FALLBACK } from "@/lib/market/dexie";

// Aggregates a collector's holdings across one or more addresses into a single flat binder feed.
// Each NFT carries its own collection's totalSupply + name so rarity is computed correctly per
// collection (VALUATION.md). Powers Your Binder.

function round(v: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export interface HeldCollection {
  id: string; // collectionSlug / chain id
  name: string;
  count: number;
}

export interface MyHoldings {
  nfts: NftData[]; // flat; each has totalSupply + collectionName set
  totalEstimateXch: number;
  totalEstimateUsd: number;
  xchUsdRate: number;
  collections: HeldCollection[];
  addresses: string[];
  truncated: boolean;
  demo: boolean;
}

const EMPTY: MyHoldings = {
  nfts: [], totalEstimateXch: 0, totalEstimateUsd: 0, xchUsdRate: XCH_USD_FALLBACK,
  collections: [], addresses: [], truncated: false, demo: false,
};

function summarize(nfts: NftData[], xchUsdRate: number, addresses: string[], truncated: boolean, demo: boolean): MyHoldings {
  const colMap = new Map<string, HeldCollection>();
  let total = 0;
  for (const n of nfts) {
    total += n.fairValue?.totalEstimate ?? 0;
    const id = n.collectionSlug;
    const c = colMap.get(id) ?? { id, name: n.collectionName ?? id, count: 0 };
    c.count += 1;
    colMap.set(id, c);
  }
  const totalEstimateXch = round(total);
  return {
    nfts,
    totalEstimateXch,
    totalEstimateUsd: round(totalEstimateXch * xchUsdRate),
    xchUsdRate,
    collections: [...colMap.values()].sort((a, b) => b.count - a.count),
    addresses,
    truncated,
    demo,
  };
}

// Live: aggregate across addresses, dedupe NFTs held across them.
export async function getMyHoldings(addresses: string[]): Promise<MyHoldings> {
  if (addresses.length === 0) return EMPTY;
  const portfolios = await Promise.all(addresses.map((a) => getAddressPortfolio(a).catch(() => null)));
  const nfts: NftData[] = [];
  const seen = new Set<string>();
  let xchUsdRate = XCH_USD_FALLBACK;
  let truncated = false;
  for (const p of portfolios) {
    if (!p) continue;
    xchUsdRate = p.xchUsdRate;
    truncated = truncated || p.truncated;
    for (const g of p.groups) {
      for (const item of g.items) {
        if (seen.has(item.nft.launcherId)) continue;
        seen.add(item.nft.launcherId);
        nfts.push({ ...item.nft, totalSupply: item.totalSupply, collectionName: item.collectionName });
      }
    }
  }
  return summarize(nfts, xchUsdRate, addresses, truncated, false);
}

// Demo: seeded Misfitz, shown as a stand-in binder while the live holdings fetch is finalized.
export async function getDemoHoldings(): Promise<MyHoldings> {
  const collection = await getCollectionBySlug("misfitz");
  if (!collection) return EMPTY;
  const [raw, market] = await Promise.all([
    listNftsForCollection("misfitz", 0, 90),
    fetchMarketContext(collection.dexieCollectionId),
  ]);
  const enriched = enrichNfts(raw, collection.totalSupply, market).map((n) => ({
    ...n,
    totalSupply: collection.totalSupply,
    collectionName: collection.name,
  }));
  return summarize(enriched, market.xchUsdRate, [], false, true);
}
