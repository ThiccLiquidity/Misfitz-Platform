import type { MgCollection, MgNftDetail, MgListItem, MgPage } from "./types";
import { decodeChiaAddress } from "@/lib/chia/bech32";
import { cachedDetailJson, cachedDetailJsonMany, storeDetailJson, cachedCollectionJson, storeCollectionJson } from "@/lib/db/nftCache";

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
// SEPARATE 429 cooldowns for background vs interactive. A whole-collection background scan trips
// MintGarden's rate limit routinely; if that pushed a SHARED cooldown, the user's wallet/collection
// (interactive) requests would stall behind it — which is exactly the "wallet load is slow after I
// visited a collection" regression. So a background 429 only slows background work; interactive
// requests keep their own (rarely-set) cooldown and stay snappy.
let _bgCooldownUntil = 0;
let _fgCooldownUntil = 0;
async function pace(background: boolean): Promise<void> {
  const now = Date.now();
  // Interactive respects only its own cooldown; background respects both (if an interactive call got
  // 429'd, background should ease off too).
  const cooldown = background ? Math.max(_bgCooldownUntil, _fgCooldownUntil) : _fgCooldownUntil;
  let start = Math.max(now, cooldown);
  if (background) {
    start = Math.max(start, _nextStart);     // background bulk scans additionally self-throttle
    _nextStart = start + MIN_GAP_MS;
  }
  const wait = start - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function noteRateLimited(background: boolean): void {
  if (background) _bgCooldownUntil = Math.max(_bgCooldownUntil, Date.now() + 1_500);
  else _fgCooldownUntil = Math.max(_fgCooldownUntil, Date.now() + 1_500);
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
      if (res.status === 429) noteRateLimited(background);
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
    if (!res.ok) { if (res.status === 429) noteRateLimited(background); return null; }
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

// Project a raw NFT detail down to ONLY the fields we consume (exactly the typed MgNftDetail shape) before
// caching it. MintGarden returns a lot we never read — most importantly a full embedded owner PROFILE
// (bio/avatar/discord, ~1.3KB) on every sale event — which bloated the shared cache. Readers only touch
// typed fields, so this is transparent to them and cuts a stored detail from ~5.5-30KB to ~1-2KB.
function slimNftDetail(d: MgNftDetail): MgNftDetail {
  const c = d.collection;
  return {
    id: d.id,
    encoded_id: d.encoded_id,
    data: {
      thumbnail_uri: d.data?.thumbnail_uri ?? null,
      preview_uri: d.data?.preview_uri ?? null,
      data_uris: d.data?.data_uris ?? null,
      metadata_json: d.data?.metadata_json
        ? {
            name: d.data.metadata_json.name,
            attributes: d.data.metadata_json.attributes,
            series_total: d.data.metadata_json.series_total,
            series_number: d.data.metadata_json.series_number,
          }
        : null,
    },
    xch_price: d.xch_price ?? null,
    owner_address: d.owner_address ? { id: d.owner_address.id, encoded_id: d.owner_address.encoded_id } : null,
    collection: {
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      thumbnail_uri: c.thumbnail_uri ?? null,
      banner_uri: c.banner_uri ?? null,
      nft_count: c.nft_count ?? null,
      floor_price: c.floor_price ?? null,
      attributes_frequency_counts: c.attributes_frequency_counts ?? null,
      volume: c.volume ?? null,
      trade_count: c.trade_count ?? null,
      creator: c.creator ?? null,
      blocked_content: c.blocked_content ?? null,
      sensitive_content: c.sensitive_content ?? null,
    },
    openrarity_rank: d.openrarity_rank ?? null,
    events: (d.events ?? []).map((e) => ({
      type: e?.type ?? null,
      xch_price: e?.xch_price ?? null,
      address: e?.address ? { encoded_id: e.address.encoded_id } : null,
      previous_address: e?.previous_address ? { encoded_id: e.previous_address.encoded_id } : null,
      payments: e?.payments ? e.payments.map((pm) => ({ asset_id: pm?.asset_id ?? null })) : null,
    })),
    is_blocked: d.is_blocked ?? null,
    blocked_content: d.blocked_content ?? null,
    sensitive_content: d.sensitive_content ?? null,
  };
}

export function getNftDetail(nftId: string, background = false, bulk = false, skipCacheRead = false): Promise<MgNftDetail> {
  return cached(`nft_${nftId}`, NFT_DETAIL_TTL, async () => {
    // L2: our persistent DB cache — once fetched, served from here forever (no MintGarden call). skipCacheRead
    // is set by getNftDetailsBatch, which already checked the cache via one MGET, so we don't re-GET a known miss.
    if (!skipCacheRead) {
      const hit = await cachedDetailJson(nftId);
      if (hit) { try { return JSON.parse(hit) as MgNftDetail; } catch { /* corrupt row -> refetch */ } }
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await getJson<MgNftDetail>(`/nfts/${encodeURIComponent(nftId)}`, DEFAULT_TIMEOUT_MS, background);
        storeDetailJson(nftId, JSON.stringify(slimNftDetail(d)), bulk); // store SLIMMED (only fields we read); return full to this caller
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
  includeMetadata = false,
  timeoutMs?: number,
  requirePrice = false,
): Promise<MgPage<MgListItem>> {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set("page", cursor);
  if (includeMetadata) q.set("include_metadata", "true"); // inline CHIP-0007 attributes per NFT
  if (requirePrice) q.set("require_price", "true"); // only NFTs currently listed for sale on MintGarden
  return getJson<MgPage<MgListItem>>(`/collections/${encodeURIComponent(collectionId)}/nfts?${q}`, timeoutMs ?? (includeMetadata ? 15_000 : DEFAULT_TIMEOUT_MS), background);
}

const EMPTY_PAGE: MgPage<MgListItem> = { items: [], next: null, previous: null };

// Batch-fetch details, reading ALL cache hits in ONE Redis MGET (vs one GET per id) — the biggest command
// saver on the enrichment/comps paths. Only cache-missing ids hit MintGarden (bounded concurrency). Order
// preserved; each entry is the detail or null.
export async function getNftDetailsBatch(ids: string[], background = false): Promise<(MgNftDetail | null)[]> {
  const out: (MgNftDetail | null)[] = new Array(ids.length).fill(null);
  if (ids.length === 0) return out;
  const cachedJsons = await cachedDetailJsonMany(ids).catch(() => new Array<string | null>(ids.length).fill(null));
  const miss: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const j = cachedJsons[i];
    if (j) { try { out[i] = JSON.parse(j) as MgNftDetail; continue; } catch { /* refetch */ } }
    miss.push(i);
  }
  if (miss.length) {
    const LIMIT = 12; let next = 0;
    await Promise.all(Array.from({ length: Math.min(LIMIT, miss.length) }, async () => {
      while (next < miss.length) { const k = miss[next++]; out[k] = await getNftDetail(ids[k], background, false, true).catch(() => null); }
    }));
  }
  return out;
}

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
