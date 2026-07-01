// ── Phase 1: persistent write-through cache ───────────────────────────────────────────────────────
// Once we've fetched an NFT detail or collection from MintGarden, we store it in OUR database so we
// never have to ask MintGarden for it again (across restarts, across users). This removes MintGarden
// from the hot path for anything we've seen before — the core of the indexer plan.
//
// Backed by Node's BUILT-IN SQLite (node:sqlite): no native dependency to install, and it runs
// identically on any OS (dev + server). Isolated from the Prisma app DB. Every operation is guarded so
// that if SQLite is somehow unavailable the whole layer degrades to a NO-OP and the app simply falls
// back to the live network — it can never break the site.

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

// NFT details are near-immutable for our uses (traits/rank/collection/name/image never change; the
// owner does, but we never rely on the cached owner). Collections change a bit more (floor/volume), and
// those live fields are refreshed from Dexie anyway — so a modest TTL is plenty.
const DETAIL_TTL_MS = 14 * 24 * 60 * 60_000; // 14 days
const COLLECTION_TTL_MS = 24 * 60 * 60_000;  //  1 day

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

export async function cachedDetailJson(id: string): Promise<string | null> {
  return (await cache())?.getDetail(id) ?? null;
}
export function storeDetailJson(id: string, json: string): void {
  void cache().then((c) => c?.putDetail(id, json)); // fire-and-forget; never blocks the request
}
export async function cachedCollectionJson(id: string): Promise<string | null> {
  return (await cache())?.getCollection(id) ?? null;
}
export function storeCollectionJson(id: string, json: string): void {
  void cache().then((c) => c?.putCollection(id, json));
}

// Generic key/value entries (sales lists, the XCH rate, collection slim lists, …). The caller supplies
// the freshness TTL because each kind of data ages differently.
export async function cacheGet(key: string, ttlMs: number): Promise<string | null> {
  return (await cache())?.getKv(key, ttlMs) ?? null;
}
export function cachePut(key: string, json: string): void {
  void cache().then((c) => c?.putKv(key, json));
}
