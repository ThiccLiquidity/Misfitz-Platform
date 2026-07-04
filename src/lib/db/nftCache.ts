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
    const mod = "@upstash/redis"; // computed specifier: keeps this optional dep out of the type graph
    _redisPromise = import(mod)
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
function redisPut(key: string, json: string): void {
  void redis().then((r) => r?.set(key, { v: json, t: Date.now() }, { ex: REDIS_GC_TTL_S })).catch(() => { /* ignore */ });
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
export async function cachedDetailJson(id: string): Promise<string | null> {
  return (await redisGet(`tf:d:${id}`, DETAIL_TTL_MS)) ?? (await cache())?.getDetail(id) ?? null;
}
export function storeDetailJson(id: string, json: string): void {
  redisPut(`tf:d:${id}`, json);
  void cache().then((c) => c?.putDetail(id, json)); // fire-and-forget; never blocks the request
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
