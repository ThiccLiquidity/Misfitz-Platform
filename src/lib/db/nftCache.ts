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
import { gzipSync, gunzipSync } from "node:zlib";

interface CacheDb {
  getDetail(id: string): string | null;
  putDetail(id: string, json: string): void;
  getCollection(id: string): string | null;
  putCollection(id: string, json: string): void;
  getKv(key: string, ttlMs: number): string | null;
  putKv(key: string, json: string): void;
}

const DETAIL_TTL_MS = 14 * 24 * 60 * 60_000; // 14 days
const COLLECTION_TTL_MS = 60 * 60_000; // 1h read-fresh (was 24h — served day-stale volume/floor on collection headers)

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
type RedisLike = { get(key: string): Promise<unknown>; mget(...keys: string[]): Promise<unknown[]>; set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>; del(...keys: string[]): Promise<unknown> };
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
export function keepAlive(p: Promise<unknown>): void {
  const safe = p.catch(() => { /* ignore */ });
  if (_waitUntil) { try { _waitUntil(safe); return; } catch { /* fall through to fire-and-forget */ } }
  void safe;
}
function redisPut(key: string, json: string, exSeconds: number = REDIS_GC_TTL_S): void {
  keepAlive(redis().then((r) => r?.set(key, { v: json, t: Date.now() }, { ex: exSeconds })));
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
// Per-NFT details: interactive + comps fetches write to shared Redis with a SHORT 48h auto-expiry (bounded
// and self-clearing) so wallet enrichment and comps rebuilds are cheap across serverless instances. BULK
// whole-collection rarity scans pass bulk=true and stay OUT of Redis — they are the high-volume thing that
// filled the store to 256MB. (Local SQLite is also written; it's a no-op on read-only serverless FS but
// real on a persistent host.)
const DETAIL_REDIS_TTL_MS = 24 * 60 * 60_000; // 24h (was 48h) — bounds the biggest storage consumer
export async function cachedDetailJson(id: string): Promise<string | null> {
  return (await redisGet(`tf:d:${id}`, DETAIL_REDIS_TTL_MS)) ?? (await cache())?.getDetail(id) ?? null;
}
export function storeDetailJson(id: string, json: string, bulk = false): void {
  if (!bulk) redisPut(`tf:d:${id}`, json, 24 * 60 * 60); // interactive/comps -> Redis, 24h ex; bulk scans skip Redis
  void cache().then((c) => c?.putDetail(id, json));
}
// Read many details in ONE Redis command (MGET) instead of N GETs — the single biggest command saver on the
// wallet/comps enrichment paths. Returns json-or-null per id (order preserved); local SQLite backfills misses.
export async function cachedDetailJsonMany(ids: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(ids.length).fill(null);
  if (ids.length === 0) return out;
  try {
    const r = await redis();
    if (r) {
      const now = Date.now();
      const CHUNK = 100; // bound each MGET's response size (a detail can be tens of KB) + per-chunk failure blast radius
      for (let start = 0; start < ids.length; start += CHUNK) {
        const slice = ids.slice(start, start + CHUNK);
        try {
          const vals = (await r.mget(...slice.map((id) => `tf:d:${id}`))) as ({ v?: string; t?: number } | null)[];
          for (let j = 0; j < slice.length; j++) {
            const o = vals[j];
            if (o && typeof o.v === "string" && typeof o.t === "number" && now - o.t < DETAIL_REDIS_TTL_MS) out[start + j] = o.v;
          }
        } catch { /* this chunk falls to local/network; other chunks unaffected */ }
      }
    }
  } catch { /* fall through to local */ }
  const c = await cache();
  if (c) for (let i = 0; i < ids.length; i++) if (out[i] == null) { try { out[i] = c.getDetail(ids[i]); } catch { /* ignore */ } }
  return out;
}
export async function cachedCollectionJson(id: string): Promise<string | null> {
  return (await redisGet(`tf:c:${id}`, COLLECTION_TTL_MS)) ?? (await cache())?.getCollection(id) ?? null;
}
export function storeCollectionJson(id: string, json: string): void {
  redisPut(`tf:c:${id}`, json, 48 * 60 * 60); // collection meta readable 1h (COLLECTION_TTL_MS); 48h ex
  void cache().then((c) => c?.putCollection(id, json));
}

// Generic key/value entries (sales lists, the XCH rate, collection slim lists, ...). The caller supplies
// the freshness TTL because each kind of data ages differently.
export async function cacheGet(key: string, ttlMs: number): Promise<string | null> {
  return (await redisGet(`tf:kv:${key}`, ttlMs)) ?? (await cache())?.getKv(key, ttlMs) ?? null;
}
export function cachePut(key: string, json: string, exSeconds?: number): void {
  // exSeconds bounds how long this key lingers in Redis. Default (30d GC) is wasteful for data that's only
  // READABLE for minutes/hours (sales, comps, holdings) — pass a tight ex so short-lived data self-clears.
  redisPut(`tf:kv:${key}`, json, exSeconds);
  void cache().then((c) => c?.putKv(key, json));
}

// Large values (a 10k-NFT roster is ~5MB of JSON) exceed Upstash's ~1MB request cap, so a plain SET fails
// silently and the roster never persists — every cold instance then re-runs the 30-70s scan. Store them
// gzip+base64 and SHARDED under tf:kvz:{key}:{i} with a tiny manifest at tf:kvz:{key}, so any size fits;
// read reassembles + gunzips (falls back to a local blob). Gzip typically takes 5MB -> ~500KB (one shard).
const KVZ_SHARD_MAX = 800_000; // base64 chars per shard, safely under the ~1MB request limit

// Write shards FIRST, manifest LAST (the manifest is the commit point) with a GENERATION stamp `g` in the
// shard keys so a torn re-write can never mix an old shard with a new one — a reader either sees a complete
// generation or falls back to a miss (safe re-scan). All awaited so a completed build actually persists
// before the serverless function is frozen.
async function putLargeInner(key: string, json: string, exSeconds: number = REDIS_GC_TTL_S): Promise<void> {
  const b64 = gzipSync(Buffer.from(json, "utf8")).toString("base64");
  const g = Date.now().toString(36);
  const shards = Math.max(1, Math.ceil(b64.length / KVZ_SHARD_MAX));
  const r = await redis();
  if (r) {
    if (shards === 1) {
      // Fits in one shard (the common case: gzipped roster/rarity ~80-200KB) -> inline it in the manifest so
      // a read is ONE GET instead of manifest + shard. Big command saver on the hottest read paths.
      await r.set(`tf:kvz:${key}`, { v: JSON.stringify({ g, shards: 1, len: b64.length, data: b64 }), t: Date.now() }, { ex: exSeconds });
    } else {
      for (let i = 0; i < shards; i++) {
        await r.set(`tf:kvz:${key}:${g}:${i}`, { v: b64.slice(i * KVZ_SHARD_MAX, (i + 1) * KVZ_SHARD_MAX), t: Date.now() }, { ex: exSeconds });
      }
      await r.set(`tf:kvz:${key}`, { v: JSON.stringify({ g, shards, len: b64.length }), t: Date.now() }, { ex: exSeconds });
    }
  }
  await cache().then((c) => c?.putKv(`z:${key}`, b64));
}
// Fire-and-forget (kept alive past function freeze). Use for non-critical large writes.
export function cachePutLarge(key: string, json: string, exSeconds?: number): void {
  keepAlive(putLargeInner(key, json, exSeconds).catch(() => { /* cache optional */ }));
}
// Awaitable — use when the caller must know the write landed before it returns (roster / rarity persist).
export async function cachePutLargeAsync(key: string, json: string, exSeconds?: number): Promise<void> {
  try { await putLargeInner(key, json, exSeconds); } catch { /* cache optional */ }
}
export async function cacheGetLarge(key: string, ttlMs: number): Promise<string | null> {
  try {
    const man = await redisGet(`tf:kvz:${key}`, ttlMs);
    if (man) {
      const m = JSON.parse(man) as { g?: string; shards: number; len?: number; data?: string };
      let joined: string | null = null;
      if (typeof m.data === "string") {
        joined = m.data; // inlined single-shard payload -> 1 GET total
      } else if (m.shards > 0 && typeof m.g === "string") {
        const r = await redis();
        if (r) {
          const keys = Array.from({ length: m.shards }, (_, i) => `tf:kvz:${key}:${m.g}:${i}`);
          const vals = (await r.mget(...keys)) as ({ v?: string } | null)[]; // ONE command for all shards
          const parts: string[] = [];
          let ok = true;
          for (const o of vals) { if (o && typeof o.v === "string") parts.push(o.v); else { ok = false; break; } }
          if (ok) joined = parts.join("");
        }
      }
      if (joined != null && (typeof m.len !== "number" || joined.length === m.len)) return gunzipSync(Buffer.from(joined, "base64")).toString("utf8");
    }
    const localB64 = (await cache())?.getKv(`z:${key}`, ttlMs);
    if (localB64) return gunzipSync(Buffer.from(localB64, "base64")).toString("utf8");
    return null;
  } catch { return null; }
}

// Cross-instance build lock (Redis SET NX EX). Stops N cold serverless instances from all scanning the same
// collection at once (the 429-storm amplifier). Returns true = you hold the lock; false = someone else does.
// Degrades to true (allow) if Redis is absent or errors — never blocks real work on a cache hiccup.
// Release a lock early (after a scan slice checkpoints) so the next poll can resume immediately instead of
// waiting out the TTL. Best-effort.
export async function releaseLock(key: string): Promise<void> {
  try { const r = await redis(); if (r) await r.del(`tf:lock:${key}`); } catch { /* ignore */ }
}
export async function tryLock(key: string, ttlS: number): Promise<boolean> {
  try {
    const r = await redis();
    if (!r) return true;
    const ok = await r.set(`tf:lock:${key}`, { t: Date.now() }, { nx: true, ex: ttlS });
    return ok === "OK" || ok === true;
  } catch { return true; }
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

// -- Ops/storage stats (safe to expose): total key count + a breakdown by kind, via a bounded SCAN. Lets
// a /status endpoint show what is actually consuming the shared store so we know if/when to upgrade. No
// secrets. Bounded to keep it cheap even on a busy DB.
export async function redisStats(deep = false): Promise<{
  configured: boolean; dbsize: number; scanned: number; complete: boolean;
  byPrefix: Record<string, number>;
}> {
  const empty = { configured: false, dbsize: -1, scanned: 0, complete: true, byPrefix: {} as Record<string, number> };
  try {
    const r = await redis();
    if (!r) return empty;
    const c = r as unknown as {
      dbsize?: () => Promise<number>;
      scan?: (cursor: string | number, opts?: { match?: string; count?: number }) => Promise<[string, string[]]>;
    };
    let dbsize = -1;
    try { dbsize = (await c.dbsize?.()) ?? -1; } catch { /* ignore */ }
    const byPrefix: Record<string, number> = {};
    let cursor: string | number = 0, scanned = 0, iters = 0, complete = true;
    if (deep && c.scan) { // SCAN is ~60 commands; only run it for an explicit deep check
      do {
        const res = (await c.scan(cursor, { count: 1000 })) as [string, string[]];
        const next: string = res[0]; const keys: string[] = res[1] ?? [];
        for (const k of keys) {
          const kind =
            k.startsWith("tf:d:") ? "detail" :
            k.startsWith("tf:c:") ? "collectionMeta" :
            k.startsWith("tf:kvz:slimlist2:") ? "roster" :
            k.startsWith("tf:kv:comps:") ? "comps" :
            k.startsWith("tf:kvz:rarityfreq:") ? "rarity" :
            k.startsWith("tf:kv:portfolio2:") ? "portfolio" :
            k.startsWith("tf:kv:holdings2:") ? "holdings" :
            k.startsWith("tf:kv:sales:") ? "sales" : "other";
          byPrefix[kind] = (byPrefix[kind] ?? 0) + 1;
        }
        scanned += keys.length; cursor = next ?? "0"; iters++;
        if (iters >= 60) { complete = String(cursor) === "0"; break; }
      } while (String(cursor) !== "0");
    }
    return { configured: true, dbsize, scanned, complete, byPrefix };
  } catch { return { ...empty, configured: true }; }
}
