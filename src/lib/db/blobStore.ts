// Pluggable LARGE-BLOB storage backend. The app caches big documents (collection rosters ~2-3MB, rarity
// tables, whale wallet rosters) that don't need Redis semantics — they're just large cached blobs, and on
// Upstash every READ of them counts against a metered bandwidth budget. This module lets those blobs live on
// a zero-egress object store (Cloudflare R2) instead, behind the SAME cacheGetLarge/cachePutLargeAsync seam
// in nftCache.ts. Default stays Redis (getActiveBlobBackend() -> null) so nothing changes until R2 is
// configured. Backends deal in the base64-gzip PAYLOAD (nftCache owns gzip/gunzip); TTL is enforced on read.
//
// Enable R2 by setting: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (and optionally
// TRAITFOLIO_BLOB_STORE=r2). With all four present the R2 backend auto-activates; set TRAITFOLIO_BLOB_STORE=
// redis to force the built-in Redis path even if R2 vars exist.

export interface BlobBackend {
  readonly name: string;
  // Return the stored base64-gzip payload if present AND not older than ttlMs; else null (miss/stale/error).
  getBlob(key: string, ttlMs: number): Promise<string | null>;
  // Store the base64-gzip payload. exSeconds is a HINT (Redis honours it as an EX; R2 relies on a bucket
  // lifecycle rule for GC + the storedAt freshness check on read).
  putBlob(key: string, b64: string, exSeconds: number): Promise<void>;
}

// ── Instrumentation ─────────────────────────────────────────────────────────
// A misconfigured R2 (bad creds) would otherwise catch-and-no-op forever with the app looking fine while
// Upstash bandwidth never drops. These counters + blobHealth() surface it via /api/cache-health.
const _stats = { gets: 0, puts: 0, misses: 0, lastError: null as string | null, lastErrorAt: null as number | null };
function noteErr(where: string, e: unknown): void {
  _stats.lastError = `${where}: ${(e as Error)?.message ?? String(e)}`.slice(0, 200);
  _stats.lastErrorAt = Date.now();
}

// ── Cloudflare R2 (S3 API, ZERO egress) ─────────────────────────────────────
// Signing is done by aws4fetch, loaded via an INDIRECT dynamic import so the package is only required when
// R2 is actually enabled (keeps it out of the default Redis path + lets typecheck pass before install).
type AwsClientLike = { fetch(input: string, init?: RequestInit): Promise<Response> };

class R2BlobBackend implements BlobBackend {
  readonly name = "r2";
  private client: AwsClientLike | null = null;
  private clientPromise: Promise<AwsClientLike | null> | null = null;
  constructor(
    private endpoint: string,
    private bucket: string,
    private accessKeyId: string,
    private secretAccessKey: string,
  ) {}

  private async aws(): Promise<AwsClientLike | null> {
    if (this.client) return this.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        try {
          // Literal specifier so Next/Vercel BUNDLES + traces aws4fetch into the lambda (a computed
          // specifier is invisible to the bundler -> R2 would silently never engage in prod). aws4fetch is a
          // declared dependency, always installed in prod; typed structurally as AwsClientLike.
          // @ts-ignore optional at typecheck time (absent in some sandboxes); present at build/runtime
          const mod = (await import("aws4fetch")) as { AwsClient: new (o: { accessKeyId: string; secretAccessKey: string; service?: string; region?: string }) => AwsClientLike };
          this.client = new mod.AwsClient({ accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey, service: "s3", region: "auto" });
          return this.client;
        } catch { return null; }
      })();
    }
    return this.clientPromise;
  }

  private url(key: string): string {
    return `${this.endpoint}/${this.bucket}/tf/${encodeURIComponent(key)}`; // opaque single-segment object key
  }

  async getBlob(key: string, ttlMs: number): Promise<string | null> {
    const aws = await this.aws();
    if (!aws) return null;
    _stats.gets++;
    let res: Response | null;
    try { res = await aws.fetch(this.url(key), { method: "GET" }); }
    catch (e) { noteErr("r2.get", e); return null; }
    if (!res || !res.ok) { if (res && res.status !== 404) noteErr("r2.get", `status ${res.status}`); _stats.misses++; return null; }
    const storedAt = Number(res.headers.get("x-amz-meta-storedat") ?? "0");
    if (!(storedAt > 0) || Date.now() - storedAt >= ttlMs) { _stats.misses++; return null; } // missing/stale -> miss (fresh iff age < ttlMs, mirrors redisGet)
    return await res.text().catch(() => null);
  }

  async putBlob(key: string, b64: string, exSeconds: number): Promise<void> {
    const aws = await this.aws();
    if (!aws) return;
    _stats.puts++;
    // Callers use a tiny exSeconds as a "delete via TTL" idiom (e.g. clearing a wallet-scan checkpoint).
    // R2 has no TTL, so honor it with an actual DELETE rather than leave a fresh object behind.
    const del = exSeconds > 0 && exSeconds <= 5;
    try {
      await aws.fetch(this.url(key), del
        ? { method: "DELETE" }
        : { method: "PUT", body: b64, headers: { "content-type": "text/plain", "x-amz-meta-storedat": String(Date.now()) } });
    } catch (e) { noteErr("r2.put", e); } // best-effort; local + network still cover it
  }
}

// ── In-memory backend (unit tests / local experiments) ──────────────────────
export class MemoryBlobBackend implements BlobBackend {
  readonly name = "memory";
  private store = new Map<string, { b64: string; at: number }>();
  async getBlob(key: string, ttlMs: number): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() - e.at >= ttlMs) return null; // fresh iff age < ttlMs (mirrors redisGet; ttl 0 => stale)
    return e.b64;
  }
  async putBlob(key: string, b64: string, exSeconds?: number): Promise<void> {
    if (exSeconds != null && exSeconds > 0 && exSeconds <= 5) { this.store.delete(key); return; }
    this.store.set(key, { b64, at: Date.now() });
  }
}

// ── Selection ────────────────────────────────────────────────────────────────
let _resolved: BlobBackend | null | undefined;   // undefined = not resolved yet; null = use built-in Redis
let _override: BlobBackend | null | undefined;    // test hook (takes precedence)

// Test seam: force a backend (or null for Redis). Pass undefined to clear and re-resolve from env.
export function setBlobBackendForTests(b: BlobBackend | null | undefined): void { _override = b; _resolved = undefined; }

// The active large-blob backend, or null to mean "use the built-in Redis path in nftCache.ts".
export function getActiveBlobBackend(): BlobBackend | null {
  if (_override !== undefined) return _override;
  if (_resolved !== undefined) return _resolved;
  _resolved = resolveFromEnv();
  return _resolved;
}

function resolveFromEnv(): BlobBackend | null {
  const mode = (process.env.TRAITFOLIO_BLOB_STORE ?? "").trim().toLowerCase();
  if (mode && mode !== "r2") return null; // explicit non-r2 (e.g. "redis") -> built-in Redis
  const account = process.env.R2_ACCOUNT_ID?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = (process.env.R2_ENDPOINT?.trim()) || (account ? `https://${account}.r2.cloudflarestorage.com` : "");
  // Auto-enable only when FULLY configured (mode "r2" without complete config safely falls back to Redis).
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return null;
  try { return new R2BlobBackend(endpoint, bucket, accessKeyId, secretAccessKey); } catch { return null; }
}

// Snapshot of blob-backend activity for /api/cache-health (per-instance since boot).
export function blobStats(): { backend: string; gets: number; puts: number; misses: number; lastError: string | null; lastErrorAt: number | null } {
  return { backend: getActiveBlobBackend()?.name ?? "redis", gets: _stats.gets, puts: _stats.puts, misses: _stats.misses, lastError: _stats.lastError, lastErrorAt: _stats.lastErrorAt };
}

// Tiny round-trip probe so a misconfigured R2 is visible instead of silently no-opping. Redis-default is
// reported healthy here (its own health is redisHealth()).
export async function blobHealth(): Promise<{ backend: string; ok: boolean; error: string | null }> {
  const b = getActiveBlobBackend();
  if (!b) return { backend: "redis", ok: true, error: null };
  try {
    const k = "__tf_health__";
    await b.putBlob(k, "aGVhbHRo", 60);           // "health" (base64)
    const v = await b.getBlob(k, 60_000);
    return { backend: b.name, ok: v === "aGVhbHRo", error: v === "aGVhbHRo" ? null : (_stats.lastError ?? "roundtrip mismatch") };
  } catch (e) { return { backend: b.name, ok: false, error: (e as Error)?.message ?? String(e) }; }
}
