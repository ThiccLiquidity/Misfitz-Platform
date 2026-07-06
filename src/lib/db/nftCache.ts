// ── Persistent write-through cache (Phase 1 local SQLite + Phase 2 shared Redis) ───────────────────
// Once we've fetched an NFT detail / collection / sales list from MintGarden or Dexie, we store it so we
// never have to ask again — across restarts, across users, and (Phase 2) across server instances.
//
// Two backends, layered, both optional and fully guarded (any failure degrades to a no-op -> the app
// just falls back to the live network; it can NEVER break the site):
//   * SHARED (Phase 2): Upstash / Vercel-KV Redis over HTTP, when KV_REST_API_URL/TOKEN (or
//     UPSTASH_REDIS_REST_URL/TOKEN) are set. The cache ALL serverless instances share, so a hot
//     collection is fetched from MintGarden ONCE and served to everyone from Redis. This removes the
//     API pressure on Vercel (where each instance's local disk is ephemeral).
//   * LOCAL (Phase 1): Node's built-in SQLite (node:sqlite) on local disk. Great for local dev and any
//     host with a persistent disk. On Vercel it doesn't persist between requests -- hence the Redis layer.
//
// Read order: Redis (shared) -> SQLite (local) -> miss (caller hits the network, then writes both).

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

interface CacheDb {
  getDetail(id: string): string | null;
  putDetail(id: string, json: string): void;
  getCollection(id: string): string | null;
  putCollection(id: string, json: string): void;
  getKv(key: string, ttlMs: number): string | null;
  putKv(key: string, json: string): void;
}

const DETAIL_TTL_MS = 14 * 24 * 60 * 60_000; // 14 days
const COLLECTION_TTL_MS = 24 * 60 * 60_000;  //  1 day

// -- Shared Redis layer (Phase 2) --------------------------------------------------------------------
// Reads env at module load. Works with Vercel KV's env vars (KV_REST_API_*) OR a direct Upstash
// integration (UPSTASH_REDIS_REST_*). @upstash/redis is HTTP-based (no socket pooling) -- ideal for
// serverless. Dynamic-imported + guarded so a missing package or missing env is a silent no-op.
// Prefix-agnostic: Vercel/Upstash may inject the keys unprefixed (KV_REST_API_URL) or with a custom
// prefix (e.g. STORAGE_KV_REST_API_URL). Match by suffix so ANY prefix works — and prefer the exact
// write token over the READ_ONLY one (which ends differently, so it won't match KV_REST_API_TOKEN).
function envBySuffix(suffixes: string[]): string {
  for (const s of suffixes) {
    if (process.env[s]) return process.env[s] as string; // exact, unprefixed match first
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v && suffixes.some((s) => k.endsWith("_" + s))) return v; // any prefix, e.g. STORAGE_<suffix>
  }
  return "";
}
const REDIS_URL = envBySuffix(["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]);
const REDIS_TOKEN = envBySuffix(["KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN"]);
const REDIS_GC_TTL_S = 30 * 24 * 60 * 60; // 30d hard expiry so orphaned keys eventually clear; freshness checked on read
type RedisLike = { get(key: string): Promise<unknown>; set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown> };
let _redisPromise: Promise<RedisLike | null> | undefined;
function redis(): Promise<RedisLike | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return Promise.resolve(null);
  if (!_redisPromise) {
    // Literal specifier so Next/webpack traces + bundles this into the serverless function. (A computed
    // specifier is invisible to the bundler, so the module is missing at runtime on Vercel -> pkgLoaded
    // false.) Still a dynamic import, so it stays lazy + guarded (missing pkg/init -> null no-op).
    _redisPromise = import("@upstash/redis")
      .then((m) => new m.Redis({ url: REDIS_URL, token: REDIS_TOKEN }) as unknown as RedisLike)
      .catch(() => null); // package not installed / init failed -> no-op
  }
  return _redisPromise;
}

// Redis stores an envelope { v: <json string>, t: <fetchedAt ms> } so freshness is checked on read with
// the caller's TTL (same semantics as SQLite). @upstash/redis serializes/parses JSON transparently.
async function redisGet(key: string, ttlMs: number): Promise<string | null> {
  try {
    const r = await redis();
    if (!r) return null;
    const o = (await r.get(key)) as { v?: string; t?: number } | null;
    if (o && typeof o.v === "string" && typeof o.t === "number" && Date.now() - o.t < ttlMs) return o.v;
    return null;
  } catch { return null; }
}
// On serverless (Vercel) a fire-and-forget write can be cut off when the function FREEZES right after the
// response — so the cache never fills and every cold request re-fetches from MintGarden. waitUntil keeps the
// write alive until it finishes. Guarded: on a normal server (or if the package is absent) it degrades to
// plain fire-and-forget (which works fine there). Loaded once at module init via a computed specifier.
let _waitUntil: ((p: Promise<unknown>) => void) | null = null;
void (async () => {
  try { const mod = await import("@vercel/functions"); _waitUntil = (mod as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil ?? null; }
  catch { _waitUntil = null; }
})();
function keepAlive(p: Promise<unknown>): void {
  const safe = p.catch(() => { /* ignore */ });
  if (_waitUntil) { try { _waitUntil(safe); return; } catch { /* fall through to fire-and-forget */ } }
  void safe;
}
function redisPut(key: string, json: string): void {
  keepAlive(redis().then((r) => r?.set(key, { v: json, t: Date.now() }, { ex: REDIS_GC_TTL_S })));
}

// -- Local SQLite layer (Phase 1) --------------------------------------------------------------------
let _dbPromise: Promise<CacheDb | null> | undefined;

async function open(): Promise<CacheDb | null> {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const dir = path.join(process.cwd(), ".cache");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(path.join(dir, "traitfolio-cache.db"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("CREATE TABLE IF NOT EXISTS nft_detail (id TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS collection (id TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL)");
    db.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at INTEGER NOT NULL)");
    const selDetail = db.prepare("SELECT json, fetched_at AS fetchedAt FROM nft_detail WHERE id = ?");
    const upDetail = db.prepare(
      "INSERT INTO nft_detail (id, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
    );
    const selCol = db.prepare("SELECT json, fetched_at AS fetchedAt FROM collection WHERE id = ?");
    const upCol = db.prepare(
      "INSERT INTO collection (id, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
    );
    const selKv = db.prepare("SELECT json, fetched_at AS fetchedAt FROM kv WHERE k = ?");
    const upKv = db.prepare(
      "INSERT INTO kv (k, json, fetched_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at",
    );
    const freshJson = (row: unknown, ttl: number): string | null => {
      const r = row as { json?: string; fetchedAt?: number } | undefined;
      if (r && typeof r.json === "string" && typeof r.fetchedAt === "number" && Date.now() - r.fetchedAt < ttl) return r.json;
      return null;
    };
    return {
      getDetail: (id) => { try { return freshJson(selDetail.get(id), DETAIL_TTL_MS); } catch { return null; } },
      putDetail: (id, json) => { try { upDetail.run(id, json, Date.now()); } catch { /* ignore */ } },
      getCollection: (id) => { try { return freshJson(selCol.get(id), COLLECTION_TTL_MS); } catch { return null; } },
      putCollection: (id, json) => { try { upCol.run(id, json, Date.now()); } catch { /* ignore */ } },
      getKv: (key, ttlMs) => { try { return freshJson(selKv.get(key), ttlMs); } catch { return null; } },
      putKv: (key, json) => { try { upKv.run(key, json, Date.now()); } catch { /* ignore */ } },
    };
  } catch {
    return null; // SQLite unavailable -> no-op cache, app falls back to network
  }
}

function cache(): Promise<CacheDb | null> {
  if (!_dbPromise) _dbPromise = open();
  return _dbPromise;
}

// -- Public API: Redis (shared) first, then SQLite (local), then miss --------------------------------
// Per-NFT details are LOCAL-ONLY (SQLite), NOT shared Redis. They are by far the highest-VOLUME thing we
// cache (every NFT of every scanned collection) and would fill the shared store, evicting the small,
// high-value aggregates (rosters, comps models, rarity tables) that actually make pages fast. Details are
// cheap to re-fetch on a cold instance; the expensive aggregates stay in Redis and persist.
export async function cachedDetailJson(id: string): Promise<string | null> {
  return (await cache())?.getDetail(id) ?? null;
}
export function storeDetailJson(id: string, json: string): void {
  void cache().then((c) => c?.putDetail(id, json)); // local SQLite only — keep the shared Redis store lean
}
export async function cachedCollectionJson(id: string): Promise<string | null> {
  return (await redisGet(`tf:c:${id}`, COLLECTION_TTL_MS)) ?? (await cache())?.getCollection(id) ?? null;
}
export function storeCollectionJson(id: string, json: string): void {
  redisPut(`tf:c:${id}`, json);
  void cache().then((c) => c?.putCollection(id, json));
}

// Generic key/value entries (sales lists, the XCH rate, collection slim lists, ...). The caller supplies
// the freshness TTL because each kind of data ages differently.
export async function cacheGet(key: string, ttlMs: number): Promise<string | null> {
  return (await redisGet(`tf:kv:${key}`, ttlMs)) ?? (await cache())?.getKv(key, ttlMs) ?? null;
}
export function cachePut(key: string, json: string): void {
  redisPut(`tf:kv:${key}`, json);
  void cache().then((c) => c?.putKv(key, json));
}

// -- Diagnostic (safe to expose): reports whether the shared Redis layer is actually working in the
// running environment, WITHOUT leaking secrets. Performs a real round-trip (set+get of tf:health:ping),
// so calling it also registers commands on the Redis dashboard = instant proof the connection is live.
export async function redisHealth(): Promise<{
  configured: boolean; urlHost: string | null; hasToken: boolean;
  pkgLoaded: boolean; roundTrip: boolean; waitUntil: boolean; error?: string;
}> {
  const configured = !!(REDIS_URL && REDIS_TOKEN);
  let urlHost: string | null = null;
  try { urlHost = REDIS_URL ? new URL(REDIS_URL).host : null; } catch { urlHost = null; }
  let pkgLoaded = false, roundTrip = false, error: string | undefined;
  try {
    const r = await redis();
    pkgLoaded = !!r;
    if (r) {
      const k = "tf:health:ping";
      await r.set(k, { v: "ok", t: Date.now() }, { ex: 60 });
      const got = (await r.get(k)) as { v?: string } | null;
      roundTrip = got?.v === "ok";
    }
  } catch (e) { error = (e as Error)?.message ?? String(e); }
  return { configured, urlHost, hasToken: !!REDIS_TOKEN, pkgLoaded, roundTrip, waitUntil: !!_waitUntil, error };
}
