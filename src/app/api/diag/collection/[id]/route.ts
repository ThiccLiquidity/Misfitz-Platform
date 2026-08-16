import { NextResponse } from "next/server";
import { cacheGetLarge, cachePutLargeAsync } from "@/lib/db/nftCache";
import { blobStats } from "@/lib/db/blobStore";
import { getCollection } from "@/lib/data-sources/mintgarden/client";
import { isSeeded } from "@/lib/data-sources/seed/registry";
import { diagLevel } from "@/lib/ops/diagAuth";

// WHY THIS EXISTS
// ---------------
// "Why does it rebuild from scratch every time?" is not answerable from the outside. The whole no-rescan
// design rests on ONE assumption — that a finished roster scan actually PERSISTS to shared storage and is
// found again by the next instance. If that write silently no-ops (bad R2 creds, a bucket that rejects a
// 2.4MB PUT, an Upstash plan block, a shard that never lands) every layer above it still "works": the app
// just rescans the whole collection on every request, forever, with no error anywhere.
//
// /api/cache-health cannot see this. Its probe writes EIGHT BYTES, which proves credentials and nothing
// else — a store can accept an 8-byte object and still reject the multi-megabyte payload that matters.
//
// So this endpoint answers, for ONE collection, the only questions that decide the outcome:
//   1. Is the roster blob actually there, how old is it, how many items, and would today's read ACCEPT it?
//   2. If it's rejected, WHY — short list, or a grown nft_count?
//   3. Is there a half-finished scan checkpoint (progress) or nothing (restarting from page 1)?
//   4. Does a REALISTIC (~1.5MB) blob survive a write→read round trip on the live backend?
//
// Read-only apart from the opt-in probe. No scans, no builds, no MintGarden paging.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SLIMLIST_TTL_MS = 30 * 24 * 60 * 60_000; // must match liveCollection
const CK_TTL_MS = 6 * 60 * 60_000;             // must match liveCollection's checkpoint read window
const RARITY_TTL_MS = 30 * 24 * 60 * 60_000;   // must match collectionFrequency DISK_TTL
const COMPS_TTL_MS = 6 * 60 * 60_000;

const hrs = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? Math.round(((Date.now() - ms) / 3_600_000) * 10) / 10 : null);

async function peek<T>(key: string, ttlMs: number, shape: (v: T) => Record<string, unknown>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  let raw: string | null = null;
  try { raw = await cacheGetLarge(key, ttlMs); } catch { /* treated as absent */ }
  const readMs = Date.now() - t0;
  if (raw == null) return { present: false, readMs };
  let parsed: T | null = null;
  try { parsed = JSON.parse(raw) as T; } catch { return { present: true, readMs, rawBytes: raw.length, parseError: true }; }
  return { present: true, readMs, rawBytes: raw.length, ...shape(parsed as T) };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  if (!id || !id.startsWith("col1") || id.length > 80) {
    return NextResponse.json({ error: "invalid collection id" }, { status: 400 });
  }
  const full = diagLevel(req) === "full";

  const col = await getCollection(id).catch(() => null);
  const declaredCount = typeof col?.nft_count === "number" ? col.nft_count : 0;

  type Slim = { items?: unknown[]; capped?: boolean; declaredCount?: number; scannedAt?: number };
  type Ck = { items?: unknown[]; cursor?: string | null };
  type Rar = { rankById?: Record<string, number>; total?: number; builtAt?: number; version?: number };

  const [roster, checkpoint, rarity, comps] = await Promise.all([
    peek<Slim>(`slimlist2:${id}`, SLIMLIST_TTL_MS, (v) => {
      const n = v.items?.length ?? 0;
      const capped = Boolean(v.capped);
      // Mirror liveCollection's acceptance test EXACTLY, so this reports what the app will really do.
      const looksFull = capped || declaredCount <= 0 || n >= Math.floor(declaredCount * 0.98);
      const sameSupply = typeof v.declaredCount === "number" && v.declaredCount === declaredCount && n > 0;
      return {
        items: n, capped,
        declaredCountAtScan: v.declaredCount ?? null,
        scannedAtHoursAgo: hrs(v.scannedAt),
        acceptedByCurrentRead: looksFull || sameSupply,
        rejectReason: looksFull || sameSupply
          ? null
          : `have ${n} of ${declaredCount} declared (need ${Math.floor(declaredCount * 0.98)}) and no matching declaredCount stamp -> FULL RESCAN on every request`,
      };
    }),
    peek<Ck>(`slimscan:${id}`, CK_TTL_MS, (v) => ({ items: v.items?.length ?? 0, hasCursor: Boolean(v.cursor) })),
    peek<Rar>(`rarityfreq:${id}`, RARITY_TTL_MS, (v) => ({
      rankedIds: v.rankById ? Object.keys(v.rankById).length : 0,
      total: v.total ?? null, version: v.version ?? null, builtHoursAgo: hrs(v.builtAt),
    })),
    peek<unknown>(`comps:${id}`, COMPS_TTL_MS, () => ({})),
  ]);

  // THE probe that /api/cache-health can't do: a realistic payload through the real large-blob path
  // (gzip -> shard/PUT -> read back -> gunzip). Operator-only (?key=<OPS_SECRET or CRON_SECRET>&probe=1)
  // because it writes real bytes to metered storage. `bytes` is tunable so you can find the exact cliff.
  let bigProbe: Record<string, unknown> | null = null;
  const url = new URL(req.url);
  if (full && url.searchParams.get("probe") === "1") {
    const want = Math.max(64_000, Math.min(4_000_000, Number(url.searchParams.get("bytes")) || 1_500_000));
    // Low-entropy but not constant, so gzip compresses it about as well as a real roster does.
    const row = (i: number) => ({ id: `probe${i}`, name: `Item #${i}`, rank: i, traits: [["Background", `v${i % 37}`], ["Body", `b${i % 19}`]] });
    const rows = []; for (let i = 0; rows.length < Math.ceil(want / 110); i++) rows.push(row(i));
    const payload = JSON.stringify({ probe: true, rows });
    const key = `diagprobe:${id}`;
    const t0 = Date.now();
    let putError: string | null = null;
    try { await cachePutLargeAsync(key, payload, 300); } catch (e) { putError = (e as Error)?.message ?? String(e); }
    const putMs = Date.now() - t0;
    const t1 = Date.now();
    let back: string | null = null;
    try { back = await cacheGetLarge(key, 300_000); } catch { /* reported as a miss below */ }
    const getMs = Date.now() - t1;
    bigProbe = {
      requestedBytes: want, payloadBytes: payload.length, putMs, getMs, putError,
      readBack: back != null, bytesBack: back?.length ?? 0,
      identical: back === payload,
      // This is the headline. false => large writes do NOT survive on this backend, which alone explains
      // "it rebuilds from scratch every time": nothing a scan produces is ever readable again.
      verdict: back === payload ? "LARGE BLOBS PERSIST" : back == null ? "LARGE WRITE LOST (read back empty)" : "LARGE BLOB CORRUPTED (truncated/mismatched)",
    };
    try { await cachePutLargeAsync(key, "", 1); } catch { /* best-effort cleanup via the delete-by-tiny-ex idiom */ }
  }

  const b = blobStats();
  return NextResponse.json(
    {
      id, name: col?.name ?? null, declaredCount,
      seedEnabled: process.env.TRAITFOLIO_SEED === "1", seeded: isSeeded(id),
      blobBackend: b.backend,
      blobCounters: { gets: b.gets, puts: b.puts, misses: b.misses, lastError: full ? b.lastError : b.lastError ? "(hidden)" : null, lastErrorHoursAgo: hrs(b.lastErrorAt) },
      roster, checkpoint, rarity, comps,
      bigProbe,
      hint: full ? "add &probe=1 (and optionally &bytes=2500000) to round-trip a realistic blob" : "add ?key=<OPS_SECRET> for full detail + the large-blob probe",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
