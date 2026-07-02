import type { NftData } from "@/types";
import { getAddressPortfolio } from "./service";
import { fetchOwnerListings } from "@/lib/data-sources/mintgarden/owner";
import { mapListItemToCard } from "@/lib/data-sources/mintgarden/map";
import { fetchXchUsdRate, fetchCollectionFloorWarm, fetchCollectionSaleFloorWarm } from "@/lib/market/dexie";
import type { MgCollection, MgListItem } from "@/lib/data-sources/mintgarden/types";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";

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

// FULL/eager: per-NFT detail for every holding (traits + estimated ranks + refined value). Used by
// the enrichment API route to stream the complete data after the fast grid is already on screen.
export async function getMyHoldingsFull(addresses: string[]): Promise<MyHoldings> {
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

// FAST/initial: build the binder from the slim holdings list + one metadata fetch per collection —
// no per-NFT detail. Renders in ~1s; YourBinder then calls the enrichment route to fill in traits and
// our own estimated ranks. Floor is resolved per collection (Dexie ask -> MintGarden -> Dexie sales ->
// cheapest current listing among holdings) so values are consistent from the first paint.
export async function getMyHoldingsFast(addresses: string[]): Promise<MyHoldings> {
  if (addresses.length === 0) return EMPTY;
  const t0 = Date.now();

  const [rate, ...owners] = await Promise.all([
    fetchXchUsdRate(),
    ...addresses.map((a) => fetchOwnerListings(a).catch(() => null)),
  ]);
  const xchUsdRate = rate ?? XCH_USD_FALLBACK;

  const items: MgListItem[] = [];
  const collections = new Map<string, MgCollection>();
  const seen = new Set<string>();
  let truncated = false;
  for (const o of owners) {
    if (!o) continue;
    truncated = truncated || o.truncated;
    for (const [id, c] of o.collections) if (!collections.has(id)) collections.set(id, c);
    for (const it of o.items) {
      if (seen.has(it.encoded_id)) continue;
      seen.add(it.encoded_id);
      items.push(it);
    }
  }

  // Resolve one floor per collection (matches service.ts precedence; holdings anchor = cheapest
  // current listing among held cards, since the fast path has no per-NFT sale history yet).
  const colIds = Array.from(collections.keys());
  const anchorsByCol = new Map<string, number[]>();
  for (const it of items) {
    if (typeof it.price === "number" && it.price > 0) {
      const arr = anchorsByCol.get(it.collection_id) ?? [];
      arr.push(it.price);
      anchorsByCol.set(it.collection_id, arr);
    }
  }
  // Non-blocking: read the last cached Dexie floors instantly (they warm/refresh in the background).
  // The binder renders right away on the MintGarden floor / holdings anchor; the refined Dexie floor
  // appears on the next load once cached. Keeps a slow Dexie off the binder's critical path.
  const dexieFloors = colIds.map((id) => fetchCollectionFloorWarm(id));
  const saleFloors = colIds.map((id) => fetchCollectionSaleFloorWarm(id));
  const floorByCol = new Map<string, number | null>();
  colIds.forEach((id, i) => {
    const dexie = dexieFloors[i];
    const mg = collections.get(id)?.floor_price ?? null;
    const sale = saleFloors[i];
    const anchors = anchorsByCol.get(id) ?? [];
    const hold = anchors.length ? Math.min(...anchors) : null;
    floorByCol.set(
      id,
      typeof dexie === "number" ? dexie : mg !== null ? mg : typeof sale === "number" ? sale : hold,
    );
  });

  const nfts: NftData[] = items.map((it) => {
    const m = mapListItemToCard(it, collections.get(it.collection_id), floorByCol.get(it.collection_id) ?? null, xchUsdRate);
    return { ...m.nft, totalSupply: m.totalSupply, collectionName: m.collectionName };
  });

  if (process.env.NODE_ENV !== "production") console.log(`[binder-perf] getMyHoldingsFast TOTAL ${Date.now() - t0}ms — ${addresses.length} wallet(s), ${nfts.length} nfts`);
  return summarize(nfts, xchUsdRate, addresses, truncated, false);
}
