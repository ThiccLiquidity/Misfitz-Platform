import type { MgCollection, MgNftDetail, MgListItem, MgPage } from "./types";
import { decodeChiaAddress } from "@/lib/chia/bech32";

// Thin typed HTTP client for the public MintGarden API. No SDK, no auth — just fetch + types.
// Isolated here so MintGardenDataSource and mappers never touch URLs or transport concerns.

const BASE = process.env.MINTGARDEN_API_BASE ?? "https://api.mintgarden.io";
const DEFAULT_TIMEOUT_MS = 12_000;

export class MintGardenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MintGardenError";
  }
}

async function getJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
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
async function getJsonOrNull<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
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

export function getNftDetail(nftId: string): Promise<MgNftDetail> {
  return cached(`nft_${nftId}`, NFT_DETAIL_TTL, async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await getJson<MgNftDetail>(`/nfts/${encodeURIComponent(nftId)}`);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1))); // backoff for transient 429s/timeouts
      }
    }
    throw lastErr;
  });
}

export function getCollection(collectionId: string): Promise<MgCollection> {
  return cached(`col_${collectionId}`, COLLECTION_TTL, () =>
    getJson<MgCollection>(`/collections/${encodeURIComponent(collectionId)}`),
  );
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
): Promise<MgPage<MgListItem>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  return getJson<MgPage<MgListItem>>(`/collections/${encodeURIComponent(collectionId)}/nfts?${q}`);
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
