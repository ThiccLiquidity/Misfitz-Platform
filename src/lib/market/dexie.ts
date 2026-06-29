// Dexie.space v1 API client — live market data for any Chia NFT collection.
//
// All functions:
//   • Cache aggressively server-side (module-level TTL map)
//   • Return null on any network/parse error — callers fall back to mock data
//   • Guard against non-nft1 / non-col1 IDs so mock launcher IDs never hit the network
//
// API base: https://api.dexie.space/v1/offers
// Offer status codes: 1 = active, 4 = completed (sold)
// Price fields in API responses are in XCH (not mojos).

const DEXIE_BASE = "https://api.dexie.space/v1";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

// Used when CoinGecko is unavailable — keeps USD fields populated with a reasonable value.
// Update this periodically until a live rate is reliably available.
export const XCH_USD_FALLBACK = 10.96;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Market context fetched once per collection page load and reused for all enrichment calls. */
export interface MarketContext {
  /** Real XCH/USD rate, or XCH_USD_FALLBACK if CoinGecko is unreachable. */
  xchUsdRate: number;
  /** Cheapest active ask in the collection (col1...) — null if no listings or not on Dexie. */
  floorXch: number | null;
}

// ── In-process TTL cache ──────────────────────────────────────────────────────
// Survives across requests in the same Node.js process.
// Upgrade to Redis/Upstash when going multi-instance.

const _cache = new Map<string, { value: unknown; expiresAt: number }>();

async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.value as T;
  const value = await fn();
  _cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

// ── XCH / USD rate ────────────────────────────────────────────────────────────

/**
 * Fetches the current XCH/USD rate from CoinGecko.
 * Cached for 1 minute. Returns null on any error.
 */
export async function fetchXchUsdRate(): Promise<number | null> {
  return withCache("xch_usd_rate", 60_000, async () => {
    try {
      const res = await fetch(
        `${COINGECKO_BASE}/simple/price?ids=chia&vs_currencies=usd`,
        { cache: "no-store" },
      );
      if (!res.ok) return null;
      const json = await res.json() as { chia?: { usd?: number } };
      const rate = json?.chia?.usd;
      return typeof rate === "number" ? rate : null;
    } catch {
      return null;
    }
  });
}

// ── Collection floor price ────────────────────────────────────────────────────

/**
 * Fetches the cheapest active ask (floor) for a collection from Dexie.
 * @param dexieCollectionId  On-chain collection id, must start with "col1"
 * Cached for 5 minutes. Returns null if no listings or on error.
 */
export async function fetchCollectionFloor(
  dexieCollectionId: string,
): Promise<number | null> {
  // Guard: only query real on-chain collection IDs
  if (!dexieCollectionId.startsWith("col1")) return null;

  return withCache(`floor_${dexieCollectionId}`, 5 * 60_000, async () => {
    try {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "1");              // active only
      url.searchParams.set("offered", dexieCollectionId);
      url.searchParams.set("requested", "xch");
      url.searchParams.set("sort", "price_asc");        // cheapest first → floor
      url.searchParams.set("page_size", "1");

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json() as { offers?: { price?: number }[] };
      const price = json?.offers?.[0]?.price;
      return typeof price === "number" ? price : null;
    } catch {
      return null;
    }
  });
}

// ── Active listing count (liquidity proxy for the confidence chip) ────────────

/**
 * Number of active asks for a collection — a cheap liquidity proxy that feeds the value-range
 * confidence (VALUATION.md Part 3). Capped fetch (we only need "few vs many"); cached 5 min.
 * Returns 0 for non-col1 ids or on error.
 */
export async function fetchCollectionListingCount(dexieCollectionId: string): Promise<number> {
  if (!dexieCollectionId.startsWith("col1")) return 0;

  return withCache(`listings_${dexieCollectionId}`, 5 * 60_000, async () => {
    try {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "1");               // active only
      url.searchParams.set("offered", dexieCollectionId);
      url.searchParams.set("requested", "xch");
      url.searchParams.set("page_size", "20");            // enough to distinguish thin vs liquid
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return 0;
      const json = (await res.json()) as { offers?: unknown[] };
      return Array.isArray(json?.offers) ? json.offers.length : 0;
    } catch {
      return 0;
    }
  });
}

// ── Per-NFT active listing ────────────────────────────────────────────────────

/**
 * Checks whether a specific NFT has an active ask on Dexie.
 * @param launcherId  NFT launcher id, must start with "nft1"
 * Cached for 2 minutes. Returns null if not listed or on error.
 */
export async function fetchNftListing(
  launcherId: string,
): Promise<{ priceXch: number } | null> {
  // Guard: mock / synthetic IDs never start with "nft1" — skip the network call
  if (!launcherId.startsWith("nft1")) return null;

  return withCache(`listing_${launcherId}`, 2 * 60_000, async () => {
    try {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "1");
      url.searchParams.set("offered", launcherId);
      url.searchParams.set("requested", "xch");
      url.searchParams.set("sort", "price_asc");   // lowest ask first
      url.searchParams.set("page_size", "1");

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return null;
      const json = await res.json() as { offers?: { price?: number }[] };
      const price = json?.offers?.[0]?.price;
      return typeof price === "number" ? { priceXch: price } : null;
    } catch {
      return null;
    }
  });
}

// ── Convenience: full context for a collection page ───────────────────────────

/**
 * Builds a MarketContext by fetching XCH rate + collection floor in parallel.
 * Safe to call on every page render — results are TTL-cached.
 * Never throws; falls back gracefully when data is unavailable.
 */
export async function fetchMarketContext(
  dexieCollectionId: string | null | undefined,
): Promise<MarketContext> {
  const [rateRaw, floorXch] = await Promise.all([
    fetchXchUsdRate(),
    dexieCollectionId ? fetchCollectionFloor(dexieCollectionId) : Promise.resolve(null),
  ]);

  return {
    xchUsdRate: rateRaw ?? XCH_USD_FALLBACK,
    floorXch,
  };
}
