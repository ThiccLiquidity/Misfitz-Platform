import { listAddressNfts, getNftDetailsBatch, getCollection } from "./client";
import { cacheGetLarge, cachePutLargeAsync, tryLock, releaseLock } from "@/lib/db/nftCache";
import { isDisplayableNft } from "./map";
import { recordTiming } from "@/lib/perf/timing";
import type { MgCollection, MgListItem, MgNftDetail, MgPage } from "./types";

// Shared by MintGardenDataSource.getNftsByOwner and the portfolio service: page through an
// address's holdings (cursor-based). Caps keep a whale wallet from firing thousands of requests;
// the caller is told when results were truncated.

export const MAX_HOLDINGS = 25000; // hard safety rail — covers essentially every real collector (incl. 20k whales)
const LEGACY_DETAIL_CAP = 2000;    // fetchOwnerNftDetails (legacy/eager path) stays capped — no budget, no resume
const PAGE_SIZE = 50; // MintGarden address endpoint rejects larger sizes (returns nothing); keep at 50

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
  // Legacy/eager path (not on the live binder). Capped low — it fetches full detail per NFT with no budget.
  const ids: string[] = [];
  let cursor: string | null | undefined = undefined;
  let truncated = false;
  do {
    const page: MgPage<MgListItem> = await listAddressNfts(address, cursor, PAGE_SIZE);
    for (const item of page.items) {
      if (ids.length >= LEGACY_DETAIL_CAP) { truncated = true; break; }
      ids.push(item.encoded_id);
    }
    cursor = page.next;
  } while (cursor && ids.length < LEGACY_DETAIL_CAP);

  const settled = await getNftDetailsBatch(ids);
  const details = settled.filter((d): d is MgNftDetail => d !== null).filter(isDisplayableNft);
  return { details, truncated };
}

// FAST path for progressive loading. Whale-safe: MintGarden caps the address endpoint at 50/page, so a 20k
// wallet is ~400 SEQUENTIAL requests — far more than one serverless invocation (60s cap) can do. So we page
// within a TIME BUDGET, checkpoint the cursor + items + per-collection metadata to Redis, and RESUME on the
// next call. warming=true means "more pages are coming — poll again". The completed roster is cached
// gzip+sharded, so a 25k-item list persists past Upstash's ~1MB per-write limit.
export interface OwnerListings {
  items: MgListItem[];
  collections: Map<string, MgCollection>;
  truncated: boolean;
  warming: boolean; // true while more pages are still being fetched (poll again to get the rest)
}

const HOLDINGS_TTL = 30 * 60_000; // completed roster: read-fresh for 30 min
const HOLDINGS_EX_S = 60 * 60;    // ...persisted 1h
const HOLDSCAN_TTL = 20 * 60_000; // in-progress checkpoint: read-fresh 20 min
const HOLDSCAN_EX_S = 30 * 60;    // ...persisted 30 min
const PAGE_BUDGET_MS = 28_000;    // per-invocation paging budget — leaves room for metadata + writes under 60s

interface CachedListings { items: MgListItem[]; collections: [string, MgCollection][]; truncated: boolean }
interface HoldingsCheckpoint { cursor: string | null; items: MgListItem[]; truncated: boolean; collections: [string, MgCollection][] }

// Fetch metadata only for collections NOT already resolved (carried in the checkpoint across passes), so a
// resume pass costs ~zero collection lookups instead of re-resolving every collection every time.
async function collectionsFor(items: MgListItem[], existing?: Map<string, MgCollection>): Promise<Map<string, MgCollection>> {
  const map = existing ? new Map(existing) : new Map<string, MgCollection>();
  const need = Array.from(new Set(items.map((i) => i.collection_id))).filter((id) => !map.has(id));
  const cols = await mapPool(need, 8, (id) => getCollection(id).catch(() => null));
  need.forEach((id, i) => { const c = cols[i]; if (c) map.set(id, c); });
  return map;
}

// listFn is a TEST SEAM (defaults to the real client) so a large-wallet fixture can drive the pager.
export interface OwnerScanOpts { budgetMs?: number; fresh?: boolean; listFn?: typeof listAddressNfts }
export async function fetchOwnerListings(address: string, opts: OwnerScanOpts = {}): Promise<OwnerListings> {
  const t0 = Date.now();
  const budgetMs = opts.budgetMs ?? PAGE_BUDGET_MS;
  const list = opts.listFn ?? listAddressNfts;
  const short = `${address.slice(0, 8)}...${address.slice(-4)}`;
  const key = address.trim().toLowerCase();

  // 1) Completed roster already cached? Serve it — no paging. (fresh=true skips it: a "Refresh" click re-pages now.)
  if (!opts.fresh) try {
    const done = await cacheGetLarge(`holdings3:${key}`, HOLDINGS_TTL);
    if (done) {
      const c = JSON.parse(done) as CachedListings;
      if (process.env.NODE_ENV !== "production") console.log(`[binder-perf] ${short} holdings CACHE HIT in ${Date.now() - t0}ms (${c.items.length} nfts)`);
      recordTiming("wallet.holdings", Date.now() - t0);
      return { items: c.items, collections: new Map(c.collections), truncated: c.truncated, warming: false };
    }
  } catch { /* fall through to resume/scan */ }

  // 2) Resume from a checkpoint if one exists (a previous invocation ran out of budget mid-scan).
  let items: MgListItem[] = [];
  let cursor: string | null | undefined = undefined;
  let truncated = false;
  let colMap = new Map<string, MgCollection>();
  if (!opts.fresh) try {
    const cp = await cacheGetLarge(`holdscan:${key}`, HOLDSCAN_TTL);
    if (cp) {
      const c = JSON.parse(cp) as HoldingsCheckpoint;
      items = c.items ?? [];
      cursor = c.cursor ?? undefined;
      truncated = c.truncated;
      colMap = new Map(c.collections ?? []);
    }
  } catch { /* start fresh */ }

  // 3) One pager per wallet at a time. If another request holds the lock, return what's checkpointed
  //    (possibly empty) and let the caller poll again — no duplicate paging storm.
  const gotLock = await tryLock(`holds:${key}`, 55).catch(() => false);
  if (!gotLock) {
    return { items, collections: await collectionsFor(items, colMap), truncated, warming: true };
  }

  // Fetch one page with a short retry so a single 429/timeout doesn't abort the whole pass. Returns null
  // only after retries fail — the caller then checkpoints + returns warming (never a false "complete").
  let metaBroken = false; // once a metadata page times out this pass, stop asking for it (don't re-pay 15s/page)
  async function fetchPage(cur: string | null | undefined, firstOfPass: boolean): Promise<MgPage<MgListItem> | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Attempt 0 asks for inline metadata (traits on first paint). Retries DROP include_metadata: a 10k-NFT
      // DID's metadata-heavy /profile page can exceed even the 15s timeout, and a page that never lands means
      // the cursor never advances ("0 NFTs, syncing…" forever). A metadata-free page is small/fast; those
      // cards' traits backfill via /api/binder enrichment, exactly like xch1 wallets already do. Once metadata
      // has timed out this pass we latch metaBroken so later pages skip it and don't re-pay the 15s timeout.
      const withMeta = attempt === 0 && !metaBroken;
      try { return await list(address, cur, PAGE_SIZE, "owned", true, false, withMeta); }
      catch {
        if (withMeta) metaBroken = true;
        // Retries are budget-gated EXCEPT the first page of a resume pass with a real budget (the poll): every
        // poll MUST move the cursor at least once or a whale can loop at zero forever. The 8s SSR pass stays
        // fast (it returns warming) while the 30s poll is allowed the extra retry to guarantee progress.
        const guarantee = firstOfPass && budgetMs > 15_000;
        if (attempt < 2 && (guarantee || Date.now() - t0 < budgetMs)) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
        else break;
      }
    }
    return null;
  }

  try {
    const seen = new Set(items.map((i) => i.encoded_id));
    let hitBudget = false;
    let pageErr = false;
    let pagesFetched = 0;
    do {
      if (Date.now() - t0 > budgetMs) { hitBudget = true; break; }
      const page = await fetchPage(cursor, pagesFetched === 0);
      if (!page) { pageErr = true; break; } // transient after retries — stop, keep progress, resume next poll
      pagesFetched += 1;
      for (const item of page.items) {
        if (items.length >= MAX_HOLDINGS) { truncated = true; break; }
        if (seen.has(item.encoded_id)) continue;
        seen.add(item.encoded_id);
        if (isDisplayableNft({ is_blocked: item.is_blocked, blocked_content: item.collection_blocked_content })) items.push(item);
      }
      cursor = page.next;
    } while (cursor && items.length < MAX_HOLDINGS);

    // COMPLETE only if we reached a genuine end (or the cap) WITHOUT budget/error stopping us early.
    let complete = !hitBudget && !pageErr && (!cursor || items.length >= MAX_HOLDINGS);

    // "This wallet is EMPTY" is a claim we only make after a confirming second look. An upstream that degrades
    // under load can 200 an empty page for a huge /profile — indistinguishable from a genuinely empty wallet.
    // One cheap metadata-free re-probe; if it disagrees or errors, stay warming so the poll retries rather than
    // telling a whale they own nothing. A genuinely empty wallet costs one tiny extra request and still reads
    // as complete-empty ("No NFTs found" stays correct for them).
    if (complete && items.length === 0) {
      try {
        const probe = await list(address, undefined, PAGE_SIZE, "owned", true, false, false);
        if ((probe.items ?? []).length > 0) complete = false; // upstream disagreed — rescan next poll
      } catch { complete = false; } // couldn't confirm empty — warming, never zero-and-done
    }

    // Persist paging progress BEFORE resolving collections (a network step), so a function kill during
    // collectionsFor never loses this pass's pages. Carries the collections resolved so far.
    if (!complete) {
      const pre: HoldingsCheckpoint = { cursor: cursor ?? null, items, truncated, collections: [...colMap.entries()] };
      await cachePutLargeAsync(`holdscan:${key}`, JSON.stringify(pre), HOLDSCAN_EX_S);
    }

    const collections = await collectionsFor(items, colMap); // only newly-seen collections hit the network

    if (complete) {
      if (items.length > 0) {
        const payload: CachedListings = { items, collections: [...collections.entries()], truncated };
        await cachePutLargeAsync(`holdings3:${key}`, JSON.stringify(payload), HOLDINGS_EX_S);
      }
      const cleared: HoldingsCheckpoint = { cursor: null, items: [], truncated, collections: [] };
      await cachePutLargeAsync(`holdscan:${key}`, JSON.stringify(cleared), 1); // drop the checkpoint
      recordTiming("wallet.holdings", Date.now() - t0);
      if (process.env.NODE_ENV !== "production") console.log(`[binder-perf] ${short} holdings COMPLETE in ${Date.now() - t0}ms (${items.length} nfts)`);
      return { items, collections, truncated, warming: false };
    }

    // Budget hit / more pages remain / transient error: update the checkpoint WITH the newly-resolved
    // collections (so the next pass skips re-resolving them) and poll again.
    const checkpoint: HoldingsCheckpoint = { cursor: cursor ?? null, items, truncated, collections: [...collections.entries()] };
    await cachePutLargeAsync(`holdscan:${key}`, JSON.stringify(checkpoint), HOLDSCAN_EX_S);
    recordTiming("wallet.holdings", Date.now() - t0);
    if (process.env.NODE_ENV !== "production") console.log(`[binder-perf] ${short} holdings PARTIAL ${items.length} nfts in ${Date.now() - t0}ms (warming)`);
    return { items, collections, truncated, warming: true };
  } finally {
    await releaseLock(`holds:${key}`);
  }
}
