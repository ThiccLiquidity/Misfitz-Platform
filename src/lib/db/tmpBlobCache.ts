// ── Per-instance /tmp cache for large blobs ──────────────────────────────────
// The layer this replaces never worked in production. nftCache's "local SQLite tier" roots its directory at
// process.cwd(), which on Vercel is /var/task and READ-ONLY — mkdirSync throws, the error is swallowed, and
// every local get/put has been a silent no-op since day one. Same for the .rarity-cache directory. So prod
// has only ever had ONE tier: the shared store, over the network, on every single read.
//
// /tmp is the one writable path on a Vercel lambda, it persists for the life of a WARM instance, and it is
// free. That makes it exactly the tier this app was missing: after an instance reads a roster once, every
// later request it serves reads ~2.4MB off local disk (single-digit ms) instead of paying a ~540ms shared
// round trip — and that read costs zero Upstash bandwidth and zero R2 egress. It is the "offload the data
// but keep the speed" requirement, satisfied without choosing between the two.
//
// Dependency-free on purpose: plain fs, no sqlite (whose availability varies by Node version) and no driver.
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const DIR = path.join("/tmp", "tf-blobs");
const MAX_ENTRY = 8 * 1024 * 1024;        // skip anything absurd rather than fill the disk with one object
const TOTAL_CAP = 128 * 1024 * 1024;      // /tmp is ~512MB; stay well clear of other tenants of it
const MAX_FILES = 400;
const SWEEP_MS = 60_000;
// Hard ceiling on how stale a LOCAL copy may be, independent of the caller's ttlMs. slimlist2 is read with
// a 30-day TTL, so without this a long-lived instance could serve its own copy for its entire life and
// never notice another instance's rewrite. Rosters are static so this mostly just costs one re-read.
const LOCAL_MAX_AGE_MS = 6 * 60 * 60_000;

// ONLY pure caches. Anything used for cross-instance COORDINATION must never be served from a per-instance
// copy — a stale local read there is a correctness bug, not a slow path:
//   slimscan:/holdscan:  resume checkpoints (and cleared via the tiny-exSeconds delete idiom) — a local
//                        copy would resurrect a checkpoint another instance finished and cleared
//   rw:*                 payout-bearing read-modify-write state (tags, LP observations, tenure) — a stale
//                        read silently drops another instance's concurrent stamp
//   comps:               one read site is the build-lock LOSER re-reading to pick up what the winner just
//                        wrote; serving it a cached miss defeats the whole lock
const ALLOW = ["slimlist2:", "rarityfreq:", "vidx:", "sales:", "holdings3:", "pwallet:", "tang:"];
export function tmpEligible(key: string): boolean {
  return ALLOW.some((p) => key.startsWith(p));
}

function fileFor(key: string): string {
  // Hash for correctness (no traversal, no length limit, no case collisions) with a readable prefix so the
  // directory is debuggable. The full key is stored in the header and checked on read, so even a hash
  // collision cannot serve the wrong object.
  const safe = key.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 48);
  const h = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return path.join(DIR, `${safe}.${h}.blob`);
}

interface Header { k?: string; t?: number; len?: number }

// Layout: <one-line JSON header>\n<base64 payload>
export async function tmpGetBlob(key: string, ttlMs: number): Promise<string | null> {
  try {
    const buf = await fs.readFile(fileFor(key), "utf8");
    const nl = buf.indexOf("\n");
    if (nl < 0) return null;
    const h = JSON.parse(buf.slice(0, nl)) as Header;
    const body = buf.slice(nl + 1);
    if (h.k !== key) return null;                                         // hash collision / recycled name
    if (typeof h.len === "number" && body.length !== h.len) return null;  // torn or truncated write
    if (typeof h.t !== "number") return null;
    const age = Date.now() - h.t;
    if (age >= ttlMs || age >= LOCAL_MAX_AGE_MS) return null;             // stale -> clean miss
    return body;
  } catch { return null; }                                                // ENOENT on a cold instance
}

export async function tmpPutBlob(key: string, b64: string, exSeconds?: number): Promise<void> {
  try {
    // Callers use a tiny exSeconds as "delete this key". Honour it locally or we would resurrect a
    // checkpoint the caller just cleared.
    if (exSeconds != null && exSeconds > 0 && exSeconds <= 5) { await fs.unlink(fileFor(key)).catch(() => {}); return; }
    if (b64.length > MAX_ENTRY) return;
    await fs.mkdir(DIR, { recursive: true });
    const dest = fileFor(key);
    // Write-then-rename: fs.writeFile onto an existing path TRUNCATES IN PLACE, so a concurrent reader on
    // the same warm instance (Fluid compute runs invocations concurrently) could read a prefix — and a
    // truncated-but-structurally-valid gzip member would return short JSON rather than throwing. rename is
    // atomic within a filesystem, so a reader sees either the whole old file or the whole new one.
    const tmp = `${dest}.${randomUUID()}.tmp`;
    const header = JSON.stringify({ k: key, t: Date.now(), len: b64.length } satisfies Header);
    try {
      await fs.writeFile(tmp, `${header}\n${b64}`);
      await fs.rename(tmp, dest);
    } finally {
      // ALWAYS clean up the temp file, including when writeFile ITSELF threw (ENOSPC mid-write). Cleaning up
      // only after a failed rename meant that under disk pressure every failed write left a partial .tmp
      // behind — so a full /tmp got fuller, permanently, and the tier disabled itself for the instance.
      // (rename removes the source on success, so this unlink is a no-op on the happy path.)
      await fs.unlink(tmp).catch(() => {});
    }
    void sweep();
  } catch { /* ENOSPC / EACCES -> no-op; the shared tiers still cover it. A cache may never break the site. */ }
  finally { void sweep(); } // also sweep after a FAILED write — that is exactly when the disk needs it
}

let _lastSweep = 0;
async function sweep(): Promise<void> {
  if (Date.now() - _lastSweep < SWEEP_MS) return;
  _lastSweep = Date.now();
  try {
    const names = await fs.readdir(DIR);
    const stats = await Promise.all(names.map(async (n) => {
      try { const s = await fs.stat(path.join(DIR, n)); return { n, size: s.size, mtime: s.mtimeMs }; } catch { return null; }
    }));
    const files = stats.filter((f): f is { n: string; size: number; mtime: number } => f !== null);
    let total = files.reduce((a, f) => a + f.size, 0);
    let count = files.length;
    if (total <= TOTAL_CAP && count <= MAX_FILES) return;
    files.sort((a, b) => a.mtime - b.mtime); // approximate LRU; entries are TTL-bounded anyway
    for (const f of files) {
      if (total <= TOTAL_CAP * 0.8 && count <= MAX_FILES * 0.8) break;
      await fs.unlink(path.join(DIR, f.n)).catch(() => {});
      total -= f.size; count -= 1;
    }
  } catch { /* ignore */ }
}

// For /api/diag: how much this instance is actually serving locally.
const _stats = { hits: 0, misses: 0, writes: 0 };
export function noteTmpHit(): void { _stats.hits++; }
export function noteTmpMiss(): void { _stats.misses++; }
export function noteTmpWrite(): void { _stats.writes++; }
export function tmpStats(): { hits: number; misses: number; writes: number } { return { ..._stats }; }
