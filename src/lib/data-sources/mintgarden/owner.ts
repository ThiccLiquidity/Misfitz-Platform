import { listAddressNfts, getNftDetail } from "./client";
import { isDisplayableNft } from "./map";
import type { MgNftDetail } from "./types";

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
