import { listAddressNfts, getNftDetail, getCollection } from "./client";
import { isDisplayableNft } from "./map";
import type { MgCollection, MgListItem, MgNftDetail } from "./types";

// Shared by MintGardenDataSource.getNftsByOwner and the portfolio service: page through an
// address's holdings (cursor-based), then eager-fetch each NFT's full detail with bounded
// concurrency (the chosen "traits everywhere" behaviour). Caps keep a whale wallet from firing
// thousands of requests; the caller is told when results were truncated.

export const MAX_HOLDINGS = 120;
const PAGE_SIZE = 50;
const DETAIL_CONCURRENCY = 12;

// Minimal concurrency pool — runs `worker` over `items`, at most `limit` in flight.
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export interface OwnerDetails {
  details: MgNftDetail[];
  truncated: boolean; // true if the address holds more than we fetched
}

export async function fetchOwnerNftDetails(address: string): Promise<OwnerDetails> {
  // 1) Page through the (slim) holdings list until we hit MAX_HOLDINGS or run out.
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  let truncated = false;
  do {
    const page = await listAddressNfts(address, cursor, PAGE_SIZE);
    for (const item of page.items) {
      if (ids.length >= MAX_HOLDINGS) {
        truncated = true;
        break;
      }
      ids.push(item.encoded_id);
    }
    cursor = page.next;
  } while (cursor && ids.length < MAX_HOLDINGS);

  // 2) Eager-fetch full detail for each, bounded concurrency. Drop any that error individually so
  //    one bad NFT doesn't sink the whole wallet view.
  const settled = await mapPool(ids, DETAIL_CONCURRENCY, async (id) => {
    try {
      return await getNftDetail(id);
    } catch {
      return null;
    }
  });
  const details = settled.filter((d): d is MgNftDetail => d !== null).filter(isDisplayableNft);
  return { details, truncated };
}

// FAST path for progressive loading: page the (slim) holdings list and fetch each UNIQUE collection's
// metadata once (supply / floor / trait-frequencies) — a handful of requests instead of one per NFT.
// The binder renders from this immediately; per-NFT traits + estimated ranks are streamed in after.
export interface OwnerListings {
  items: MgListItem[];
  collections: Map<string, MgCollection>;
  truncated: boolean;
}

export async function fetchOwnerListings(address: string): Promise<OwnerListings> {
  const items: MgListItem[] = [];
  let cursor: string | null | undefined = undefined;
  let truncated = false;
  do {
    const page = await listAddressNfts(address, cursor, PAGE_SIZE);
    for (const item of page.items) {
      if (items.length >= MAX_HOLDINGS) { truncated = true; break; }
      if (isDisplayableNft({ is_blocked: item.is_blocked, blocked_content: item.collection_blocked_content })) items.push(item);
    }
    cursor = page.next;
  } while (cursor && items.length < MAX_HOLDINGS);

  const colIds = Array.from(new Set(items.map((i) => i.collection_id)));
  const cols = await mapPool(colIds, 8, (id) => getCollection(id).catch(() => null));
  const collections = new Map<string, MgCollection>();
  colIds.forEach((id, i) => { const c = cols[i]; if (c) collections.set(id, c); });

  return { items, collections, truncated };
}
