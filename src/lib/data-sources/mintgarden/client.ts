import type { MgCollection, MgNftDetail, MgListItem, MgPage } from "./types";
import { decodeChiaAddress } from "@/lib/chia/bech32";
import { cachedDetailJson, storeDetailJson, cachedCollectionJson, storeCollectionJson } from "@/lib/db/nftCache";

// Thin typed HTTP client for the public MintGarden API. No SDK, no auth — just fetch + types.
// Isolated here so MintGardenDataSource and mappers never touch URLs or transport concerns.

const BASE = process.env.MINTGARDEN_API_BASE ?? "https://api.mintgarden.io";
const DEFAULT_TIMEOUT_MS = 6_000; // normal responses are <1s; a longer wait means throttled/stuck — give up sooner

// ── Global request pacing ───────────────────────────────────────────────────────────────────────
// MintGarden's public data API is rate-limited. With many pooled workers firing at once we trip the
// limit and get 429s — and if every request then retries immediately into another 429, a 2-minute
// build turns into 10+. So we (a) start requests at least MIN_GAP_MS apart (caps bursts), and (b) after
// a 429 pause the WHOLE pool briefly so it stops hammering a limit that's already tripped. Trades a
// little peak throughput for avoiding the catastrophic death-spiral.
// Only BACKGROUND bulk scans are rate-limited (they were the source of the 429 death-spiral: thousands
// of detail fetches for a whole-collection rarity/comps build). Interactive requests — the wallet or
// collection a user is actively waiting on — fire immediately (respecting only a 429 cooldown), so they
// are never stuck behind a queue of background work. This is what keeps address pulls snappy.
const MIN_GAP_MS = 45; // ~22 requests/sec ceiling for background bulk scans
let _nextStart = 0;
let _cooldownUntil = 0;
async function pace(background: boolean): Promise<void> {
  const now = Date.now();
  let start = Math.max(now, _cooldownUntil); // everyone waits out a 429 cooldown
  if (background) {
    start = Math.max(start, _nextStart);     // background bulk scans additionally self-throttle
    _nextStart = start + MIN_GAP_MS;
  }
  const wait = start - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function noteRateLimited(): void {
  _cooldownUntil = Math.max(_cooldownUntil, Date.now() + 1_500); // collective breather after a 429
}

export class MintGardenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MintGardenError";
  }
}

async function getJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS, background = false): Promise<T> {
  await pace(background);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 429) noteRateLimited();
      throw new MintGardenError(`MintGarden ${path} -> HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MintGardenError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new MintGardenError(`MintGarden ${path} timed out after ${timeoutMs}ms`);
    }
    throw new MintGardenError(`MintGarden ${path} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Tolerant variant: returns null on any failure (non-200, empty body, bad JSON, timeout) instead
// of throwing. Used for address holdings, where "this address holds nothing" is a normal, non-error
// outcome that must NOT surface as "couldn't reach MintGarden".
async function getJsonOrNull<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS, background = false): Promise<T | null> {
  await pace(background);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) { if (res.status === 429) noteRateLimited(); return null; }
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── In-process TTL cache ──────────────────────────────────────────────────────
// NFT details + collection metadata change rarely; caching them makes re-opening a wallet (or the
// same NFT across views) near-instant and avoids re-fetching shared collections. Survives across
// requests in the same Node process.
const _cache = new Map<string, { value: unknown; expiresAt: number }>();
// In-flight coalescing: when several callers miss the same key at once (e.g. many cards needing the
// same collection's detail, or two visitors opening the same NFT), they share ONE network call
// instead of each firing their own. Cuts redundant upstream traffic sharply under load.
const _inflight = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;
  const pending = _inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    try {
      const value = await fn();
      _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      _inflight.delete(key); // clear on success OR failure so a failed fetch can be retried
    }
  })();
  _inflight.set(key, p);
  return p as Promise<T>;
}

const NFT_DETAIL_TTL = 10 * 60_000;
const COLLECTION_TTL = 10 * 60_000;

export function getNftDetail(nftId: string, background = false): Promise<MgNftDetail> {
  return cached(`nft_${nftId}`, NFT_DETAIL_TTL, async () => {
    // L2: our persistent DB cache — once fetched, served from here forever (no MintGarden call).
    const hit = await cachedDetailJson(nftId);
    if (hit) { try { return JSON.parse(hit) as MgNftDetail; } catch { /* corrupt row -> refetch */ } }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await getJson<MgNftDetail>(`/nfts/${encodeURIComponent(nftId)}`, DEFAULT_TIMEOUT_MS, background);
        storeDetailJson(nftId, JSON.stringify(d)); // write-through
        return d;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, Math.min(3_000, 400 * 2 ** attempt))); // exp backoff for transient 429s/timeouts
      }
    }
    throw lastErr;
  });
}

export function getCollection(collectionId: string, background = false): Promise<MgCollection> {
  return cached(`col_${collectionId}`, COLLECTION_TTL, async () => {
    const hit = await cachedCollectionJson(collectionId);
    if (hit) { try { return JSON.parse(hit) as MgCollection; } catch { /* refetch */ } }
    const c = await getJson<MgCollection>(`/collections/${encodeURIComponent(collectionId)}`, DEFAULT_TIMEOUT_MS, background);
    storeCollectionJson(collectionId, JSON.stringify(c)); // write-through
    return c;
  });
}

// Top/trending collections — MintGarden's /collections is sorted by lifetime volume (desc), with a
// cursor. Perfect for a discovery feed. Cached 5 min.
export function listTopCollections(cursor?: string | null, size = 24): Promise<MgPage<MgCollection>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  return cached(`topcols_${cursor ?? "0"}_${size}`, 5 * 60_000, () =>
    getJson<MgPage<MgCollection>>(`/collections?${q}`),
  );
}

// Search collections by name (the /search endpoint also returns nfts/profiles, which we ignore here).
export function searchCollections(query: string): Promise<MgCollection[]> {
  const q = query.trim();
  if (!q) return Promise.resolve([]);
  return cached(`colsearch_${q.toLowerCase()}`, 5 * 60_000, async () => {
    const res = await getJsonOrNull<{ collections?: MgCollection[] }>(`/search?query=${encodeURIComponent(q)}`);
    return res?.collections ?? [];
  });
}

export function listCollectionNfts(
  collectionId: string,
  cursor?: string | null,
  size = 50,
  background = false,
): Promise<MgPage<MgListItem>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  return getJson<MgPage<MgListItem>>(`/collections/${encodeURIComponent(collectionId)}/nfts?${q}`, DEFAULT_TIMEOUT_MS, background);
}

const EMPTY_PAGE: MgPage<MgListItem> = { items: [], next: null, previous: null };

// NFTs held by an xch1 ADDRESS or a did:chia PROFILE. Both decode (bech32m) to a 32-byte hex; we pick
// /address vs /profile by the human-readable part. Tolerates empty results so "holds nothing" reads as
// "no NFTs", never an error.
export async function listAddressNfts(
  address: string,
  cursor?: string | null,
  size = 50,
  type = "owned",
): Promise<MgPage<MgListItem>> {
  const decoded = decodeChiaAddress(address);
  if (!decoded) return EMPTY_PAGE;
  // DID profiles hold NFTs across many per-NFT addresses, so a DID must be looked up via /profile,
  // not /address (which only sees one puzzle hash). xch1 addresses use /address.
  const endpoint = decoded.hrp.startsWith("did:chia") ? "profile" : "address";
  const q = new URLSearchParams({ type, size: String(size) });
  if (cursor) q.set("page", cursor);
  const page = await getJsonOrNull<MgPage<MgListItem>>(`/${endpoint}/${decoded.hex}/nfts?${q}`);
  if (!page) return EMPTY_PAGE;
  return { items: page.items ?? [], next: page.next ?? null, previous: page.previous ?? null };
}
