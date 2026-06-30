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
// Coalesce concurrent misses for the same key into one upstream call (e.g. several collection views
// resolving the same floor at once) so a cache gap can't trigger a thundering herd of Dexie hits.
const _inflight = new Map<string, Promise<unknown>>();

async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
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
      _inflight.delete(key);
    }
  })();
  _inflight.set(key, p);
  return p as Promise<T>;
}

// All Dexie / CoinGecko calls go through here. These are awaited server-side while the page renders,
// and the upstreams have no SLA — without a timeout one slow/stalled response hangs the whole request
// forever (the "endless spinner"). On timeout we abort; the caller's try/catch then falls back to a
// null/empty result, so the binder still loads (just without that one number) instead of never loading.
const MARKET_FETCH_TIMEOUT_MS = 6000;
async function tfetch(url: string, init?: RequestInit, timeoutMs = MARKET_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: "no-store", ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── XCH / USD rate ────────────────────────────────────────────────────────────

/**
 * XCH/USD rate from CoinGecko — used ONLY for the cosmetic "≈ $" labels.
 *
 * Stale-while-revalidate, and NON-BLOCKING on purpose: CoinGecko's free tier is 5-15 calls/min and
 * frequently slow / rate-limited, so we never let a page render wait on it. We return the last known
 * rate immediately (seeded with XCH_USD_FALLBACK on a cold process) and kick a background refresh
 * when it's stale. Worst case a page shows a slightly old dollar figure for a few seconds, never a
 * spinner. The XCH values themselves never depend on this.
 */
let _rateValue = XCH_USD_FALLBACK;
let _rateAt = 0;
let _rateRefreshing = false;

function refreshXchUsdRate(): void {
  if (_rateRefreshing) return;
  _rateRefreshing = true;
  (async () => {
    try {
      const res = await tfetch(`${COINGECKO_BASE}/simple/price?ids=chia&vs_currencies=usd`, undefined, 3000);
      if (res.ok) {
        const json = (await res.json()) as { chia?: { usd?: number } };
        const rate = json?.chia?.usd;
        if (typeof rate === "number" && rate > 0) {
          _rateValue = rate;
          _rateAt = Date.now();
        }
      }
    } catch {
      /* keep last known rate */
    } finally {
      _rateRefreshing = false;
    }
  })();
}

export async function fetchXchUsdRate(): Promise<number | null> {
  if (Date.now() - _rateAt > 60_000) refreshXchUsdRate(); // fire-and-forget; do NOT await
  return _rateValue;
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
      url.searchParams.set("status", "0");              // 0 = active on Dexie (1 is "pending")
      url.searchParams.set("offered", dexieCollectionId);
      url.searchParams.set("requested", "xch");         // REQUIRED for Dexie to honor price sort
      url.searchParams.set("sort", "price_asc");        // cheapest first → floor (only works with requested set)
      url.searchParams.set("page_size", "20");

      const res = await tfetch(url.toString());
      if (!res.ok) return null;
      const json = await res.json() as { offers?: { price?: number; requested?: { id?: string }[] }[] };
      // Cheapest CLEAN single-asset XCH offer = floor. Skip multi-asset (XCH+CAT) offers whose XCH leg
      // would understate the real cost. Sorted ascending, so the first clean one is the floor.
      for (const o of json?.offers ?? []) {
        const req = o.requested ?? [];
        const xchOnly = req.length === 1 && (req[0].id ?? "").toLowerCase() === "xch";
        if (xchOnly && typeof o.price === "number" && o.price > 0) return o.price;
      }
      return null;
    } catch {
      return null;
    }
  });
}

// ── Collection recent-sale floor ──────────────────────────────────────────────

/**
 * Derives a collection floor from RECENT COMPLETED sales on Dexie (status 4), for collections with
 * no active asks and no MintGarden floor. Uses a low percentile of the last ~25 sales (min for tiny
 * samples) so a single lowball trade doesn't set the floor. Cached 10 min. Returns null on error /
 * no sales / non-col1 id.
 */
export async function fetchCollectionSaleFloor(dexieCollectionId: string): Promise<number | null> {
  if (!dexieCollectionId.startsWith("col1")) return null;

  return withCache(`salefloor_${dexieCollectionId}`, 10 * 60_000, async () => {
    try {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "4");                // completed (sold)
      url.searchParams.set("offered", dexieCollectionId);
      url.searchParams.set("requested", "xch");
      url.searchParams.set("sort", "date_completed");     // most recent first
      url.searchParams.set("page_size", "25");
      const res = await tfetch(url.toString());
      if (!res.ok) return null;
      const json = (await res.json()) as { offers?: { price?: number }[] };
      const prices = (json?.offers ?? [])
        .map((o) => o.price)
        .filter((p): p is number => typeof p === "number" && p > 0)
        .sort((a, b) => a - b);
      if (prices.length === 0) return null;
      const idx = prices.length >= 5 ? Math.floor(0.15 * (prices.length - 1)) : 0;
      return prices[idx];
    } catch {
      return null;
    }
  });
}

// ── Non-blocking floor reads (binder) ─────────────────────────────────────────
// Return the last cached Dexie floor INSTANTLY (fresh or stale) and warm/refresh in the background.
// Never await the network, so a slow/rate-limited Dexie can't gate the binder render — the caller
// (getMyHoldingsFast) falls back to the MintGarden floor / holdings anchor until the real floor is
// cached, then picks it up on the next load. The shop/collection pages keep the blocking variants so
// their deal scores stay anchored to the true floor.
export function fetchCollectionFloorWarm(dexieCollectionId: string): number | null {
  if (!dexieCollectionId.startsWith("col1")) return null;
  const hit = _cache.get(`floor_${dexieCollectionId}`);
  if (!hit || Date.now() >= hit.expiresAt) void fetchCollectionFloor(dexieCollectionId).catch(() => {});
  return hit ? (hit.value as number | null) : null;
}
export function fetchCollectionSaleFloorWarm(dexieCollectionId: string): number | null {
  if (!dexieCollectionId.startsWith("col1")) return null;
  const hit = _cache.get(`salefloor_${dexieCollectionId}`);
  if (!hit || Date.now() >= hit.expiresAt) void fetchCollectionSaleFloor(dexieCollectionId).catch(() => {});
  return hit ? (hit.value as number | null) : null;
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
      url.searchParams.set("status", "0");               // 0 = active on Dexie
      url.searchParams.set("offered", dexieCollectionId);
      url.searchParams.set("page_size", "20");            // enough to distinguish thin vs liquid
      const res = await tfetch(url.toString());
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
      url.searchParams.set("status", "0");         // 0 = active on Dexie
      url.searchParams.set("offered", launcherId);
      url.searchParams.set("sort", "price_asc");   // lowest ask first
      url.searchParams.set("page_size", "1");

      const res = await tfetch(url.toString());
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

// ── NFT offer file (for "copy offer") ─────────────────────────────────────────
// The active Dexie offer for a listed NFT carries the full `offer1...` string a buyer pastes into
// their wallet to accept the trade. We surface it for copy (never execute the trade ourselves).
// Cached 2 min. Returns null for non-nft1 ids, when nothing is listed on Dexie, or on error.
export async function fetchNftOffer(launcherId: string): Promise<{ offer: string; priceXch: number } | null> {
  if (!launcherId.startsWith("nft1")) return null;
  return withCache(`offerfile_${launcherId}`, 2 * 60_000, async () => {
    try {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "0");          // active
      url.searchParams.set("offered", launcherId);
      url.searchParams.set("sort", "price_asc");    // cheapest active offer
      url.searchParams.set("page_size", "5");
      const res = await tfetch(url.toString());
      if (!res.ok) return null;
      const json = (await res.json()) as {
        offers?: { offer?: string; price?: number; requested?: { id?: string }[] }[];
      };
      // Prefer an offer that requests XCH (a plain sale), cheapest first.
      const o =
        (json?.offers ?? []).find(
          (of) => typeof of.offer === "string" && (of.requested ?? []).some((r) => r.id === "xch"),
        ) ?? (json?.offers ?? []).find((of) => typeof of.offer === "string");
      if (!o || typeof o.offer !== "string") return null;
      return { offer: o.offer, priceXch: typeof o.price === "number" ? o.price : 0 };
    } catch {
      return null;
    }
  });
}

// ── Collection active offers (for accurate shop listings + multi-asset detection) ──────────────
// Dexie's offers carry the FULL requested-asset list, so we can tell a clean NFT-for-XCH listing from
// one that also wants a CAT (which would make the "deal" misleading). Keyed by the offered NFT's
// launcher id (hex) so we can overlay onto our cards. Cached 5 min; capped pages for huge collections.
export interface CollectionOffer {
  offerId: string;    // Dexie offer id (for the dexie.space/offers/{id} link)
  priceXch: number;   // Dexie price = the XCH leg of the offer (NOT CAT-inclusive). Trust only when xchOnly.
  requested: { code: string; amount: number }[]; // full breakdown (XCH + any CATs)
  xchOnly: boolean;   // requested is exactly XCH (a clean XCH buy)
  multiNft: boolean;  // offer bundles more than one NFT
}

interface DexieOfferRaw {
  id?: string;
  price?: number;
  offered?: { is_nft?: boolean; id?: string }[];
  requested?: { id?: string; code?: string; amount?: number }[];
}

export async function fetchCollectionActiveOffers(colId: string, maxPages = 40): Promise<Map<string, CollectionOffer>> {
  if (!colId.startsWith("col1")) return new Map();
  return withCache(`coloffers_${colId}`, 5 * 60_000, async () => {
    const map = new Map<string, CollectionOffer>();
    const fetchPage = async (page: number): Promise<{ offers: DexieOfferRaw[]; count: number }> => {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "0"); // active
      url.searchParams.set("offered", colId);
      url.searchParams.set("requested", "xch"); // REQUIRED — without it Dexie ignores the price sort
      url.searchParams.set("sort", "price_asc"); // cheapest first — so the page cap keeps the deal-relevant offers
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "100");
      const res = await tfetch(url.toString());
      if (!res.ok) return { offers: [], count: 0 };
      const json = (await res.json()) as { offers?: DexieOfferRaw[]; count?: number };
      return { offers: json?.offers ?? [], count: json?.count ?? 0 };
    };
    // NOTE: requested=xch returns any offer that wants XCH, INCLUDING multi-asset (XCH+CAT) offers.
    // xchOnly below (requested.length===1) is what distinguishes a clean XCH buy from a hidden-CAT trap.
    const ingest = (offers: DexieOfferRaw[]) => {
      for (const o of offers) {
        const nfts = (o.offered ?? []).filter((x) => x.is_nft && x.id);
        if (nfts.length === 0) continue;
        const requested = (o.requested ?? [])
          .map((r) => ({ code: (r.code ?? r.id ?? "").toUpperCase(), amount: typeof r.amount === "number" ? r.amount : 0 }))
          .filter((r) => r.code);
        const xchOnly = requested.length === 1 && requested[0].code === "XCH";
        const offer: CollectionOffer = {
          offerId: o.id ?? "",
          priceXch: typeof o.price === "number" ? o.price : 0,
          requested,
          xchOnly,
          multiNft: nfts.length > 1,
        };
        for (const nft of nfts) if (nft.id && !map.has(nft.id)) map.set(nft.id, offer); // cheapest wins
      }
    };
    try {
      const first = await fetchPage(1);
      ingest(first.offers);
      const totalPages = Math.min(maxPages, Math.ceil(first.count / 100));
      // Remaining pages in parallel (page-number pagination), bounded concurrency.
      const rest: number[] = [];
      for (let p = 2; p <= totalPages; p++) rest.push(p);
      const LIMIT = 6;
      for (let i = 0; i < rest.length; i += LIMIT) {
        const batch = await Promise.all(rest.slice(i, i + LIMIT).map((p) => fetchPage(p).catch(() => ({ offers: [], count: 0 }))));
        for (const b of batch) ingest(b.offers);
      }
    } catch {
      /* partial map is fine */
    }
    return map;
  });
}

// ── Completed clean-XCH sales (comparable-sales valuation) ──────────────────────────────────────
// Real settled prices, the evidence behind the comps model. status=4 = completed; requested=xch is
// REQUIRED for Dexie to honor the date sort and filters the denomination. We keep only single-NFT,
// XCH-ONLY sales (a bundle or XCH+CAT sale isn't a clean per-NFT price). Most-recent sale per NFT.
// Cached 30 min. Returns [] for non-col1 ids or on error.
export interface CompletedSale {
  id: string;    // sold NFT launcher id (hex)
  price: number; // clean XCH price
  date: string;  // ISO completion date
}

export async function fetchCollectionCompletedSales(colId: string, maxPages = 30): Promise<CompletedSale[]> {
  if (!colId.startsWith("col1")) return [];
  return withCache(`colsales_${colId}`, 30 * 60_000, async () => {
    const byNft = new Map<string, CompletedSale>(); // most-recent sale per NFT (date-desc, first wins)
    const fetchPage = async (page: number): Promise<{ offers: DexieOfferRaw[]; count: number }> => {
      const url = new URL(`${DEXIE_BASE}/offers`);
      url.searchParams.set("status", "4");                // completed (sold)
      url.searchParams.set("offered", colId);
      url.searchParams.set("requested", "xch");           // required for sort; fixes denomination
      url.searchParams.set("sort", "date_completed");     // most recent first
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "100");
      const res = await tfetch(url.toString());
      if (!res.ok) return { offers: [], count: 0 };
      const json = (await res.json()) as { offers?: (DexieOfferRaw & { date_completed?: string; date_found?: string })[]; count?: number };
      return { offers: json?.offers ?? [], count: json?.count ?? 0 };
    };
    const ingest = (offers: (DexieOfferRaw & { date_completed?: string; date_found?: string })[]) => {
      for (const o of offers) {
        const req = (o.requested ?? []);
        const xchOnly = req.length === 1 && (req[0].code ?? req[0].id ?? "").toLowerCase() === "xch";
        const nfts = (o.offered ?? []).filter((x) => x.is_nft && x.id);
        if (!xchOnly || nfts.length !== 1 || typeof o.price !== "number" || o.price <= 0) continue;
        const id = nfts[0].id as string;
        if (!byNft.has(id)) byNft.set(id, { id, price: o.price, date: o.date_completed || o.date_found || "" });
      }
    };
    try {
      const first = await fetchPage(1);
      ingest(first.offers as never);
      const totalPages = Math.min(maxPages, Math.ceil((first.count || 0) / 100));
      const rest: number[] = [];
      for (let p = 2; p <= totalPages; p++) rest.push(p);
      const LIMIT = 6;
      for (let i = 0; i < rest.length; i += LIMIT) {
        const batch = await Promise.all(rest.slice(i, i + LIMIT).map((p) => fetchPage(p).catch(() => ({ offers: [], count: 0 }))));
        for (const b of batch) ingest(b.offers as never);
      }
    } catch {
      /* partial is fine */
    }
    return [...byNft.values()];
  });
}
