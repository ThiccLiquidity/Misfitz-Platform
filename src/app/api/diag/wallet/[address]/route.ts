import { NextResponse } from "next/server";
import { cacheGetLarge } from "@/lib/db/nftCache";
import { blobStats } from "@/lib/db/blobStore";
import { tmpStats } from "@/lib/db/tmpBlobCache";
import { fetchOwnerListings } from "@/lib/data-sources/mintgarden/owner";
import { getMyHoldingsFast } from "@/lib/portfolio/myHoldings";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { diagLevel } from "@/lib/ops/diagAuth";

// Wallet-side twin of /api/diag/collection/[id].
//
// The binder cannot report its own failures: getMyHoldingsFast wraps everything in a try/catch and degrades
// to `warming: true`, which is right for users and useless for debugging — a hard upstream failure and a
// slow whale wallet look identical from the outside. This runs the SAME path with the catch REMOVED and
// reports what actually happened, plus the state of every cache the binder depends on.
//
// GET /api/diag/wallet/<xch1... or did:chia...>?key=<OPS_SECRET>
//   &budget=20000   paging budget in ms (default 20s; SSR uses 8s)
//   &live=1         actually run the scan (otherwise only cache state is reported — no upstream calls)
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HOLDINGS_TTL = 30 * 60_000;   // must match owner.ts
const HOLDSCAN_TTL = 20 * 60_000;   // must match owner.ts
const SNAP_TTL_MS = 14 * 24 * 60 * 60_000;

const hrs = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 ? Math.round(((Date.now() - ms) / 3_600_000) * 100) / 100 : null);

async function peek<T>(key: string, ttlMs: number, shape: (v: T) => Record<string, unknown>): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  let raw: string | null = null;
  try { raw = await cacheGetLarge(key, ttlMs); } catch { /* absent */ }
  const readMs = Date.now() - t0;
  if (raw == null) return { present: false, readMs };
  try { return { present: true, readMs, rawBytes: raw.length, ...shape(JSON.parse(raw) as T) }; }
  catch { return { present: true, readMs, rawBytes: raw.length, parseError: true }; }
}

export async function GET(req: Request, { params }: { params: { address: string } }) {
  const address = decodeURIComponent(params.address ?? "").trim().toLowerCase();
  if (!address || address.length > 120 || !isValidChiaOwnerId(address)) {
    return NextResponse.json({ error: "invalid chia address or did" }, { status: 400 });
  }
  const full = diagLevel(req) === "full";
  if (!full) return NextResponse.json({ error: "operator only — add ?key=<OPS_SECRET>" }, { status: 403 });

  const url = new URL(req.url);
  const budgetMs = Math.max(2_000, Math.min(50_000, Number(url.searchParams.get("budget")) || 20_000));
  const live = url.searchParams.get("live") === "1";
  const key = address;

  type Held = { items?: unknown[]; collections?: unknown[]; truncated?: boolean };
  type Ck = { items?: unknown[]; cursor?: string | null; collections?: unknown[]; done?: boolean };

  const [holdings3, holdscan] = await Promise.all([
    peek<Held>(`holdings3:${key}`, HOLDINGS_TTL, (v) => ({
      items: v.items?.length ?? 0, collections: v.collections?.length ?? 0, truncated: Boolean(v.truncated),
    })),
    peek<Ck>(`holdscan:${key}`, HOLDSCAN_TTL, (v) => ({
      items: v.items?.length ?? 0, collections: v.collections?.length ?? 0, hasCursor: Boolean(v.cursor), pagingDone: v.done === true,
    })),
  ]);
  // pwallet: is keyed by a hash of the address set, so it can't be peeked from one address alone —
  // reported via the live run's timing instead.

  let scan: Record<string, unknown> | null = null;
  let holdings: Record<string, unknown> | null = null;
  if (live) {
    // UNCAUGHT on purpose (well, caught here and REPORTED). This is the one place the real error is visible.
    const t0 = Date.now();
    try {
      const r = await fetchOwnerListings(address, { budgetMs });
      scan = {
        ms: Date.now() - t0,
        items: r.items.length,
        collections: r.collections.size,
        truncated: r.truncated,
        // warming here now means PAGING is unfinished. Before the fix it also went true when collection
        // metadata was incomplete, which silently disabled the artifact stamp and the wallet snapshot.
        warming: r.warming,
        verdict: r.warming ? "STILL PAGING — poll again" : "COMPLETE — roster persisted",
      };
    } catch (e) {
      scan = { ms: Date.now() - t0, threw: true, error: (e as Error)?.message ?? String(e), stack: (e as Error)?.stack?.split("\n").slice(0, 4).join(" | ") };
    }

    const t1 = Date.now();
    try {
      const h = await getMyHoldingsFast([address], { budgetMs });
      holdings = {
        ms: Date.now() - t1,
        nfts: h.nfts.length,
        collections: h.collections.length,
        warming: h.warming,
        truncated: h.truncated,
        totalEstimateXch: h.totalEstimateXch,
        // If nfts > 0 but every card lacks a rank, the artifact stamp did not run — that is what turns a
        // fast load into a few hundred client enrichment round trips.
        cardsWithRank: h.nfts.filter((n) => n.rarityRank != null).length,
        cardsWithTraits: h.nfts.filter((n) => (n.traits?.length ?? 0) > 0).length,
        cardsWithValue: h.nfts.filter((n) => n.fairValue != null).length,
      };
    } catch (e) {
      holdings = { ms: Date.now() - t1, threw: true, error: (e as Error)?.message ?? String(e) };
    }
  }

  const b = blobStats();
  return NextResponse.json(
    {
      address, budgetMs, live,
      blobBackend: b.backend,
      blobCounters: { gets: b.gets, puts: b.puts, putFails: b.putFails, lastPutStatus: b.lastPutStatus, misses: b.misses, lastError: b.lastError, lastErrorHoursAgo: hrs(b.lastErrorAt) },
      localTmp: tmpStats(),
      holdings3, holdscan,
      scan, holdings,
      hint: live ? "scan.warming=false means the roster persisted; holdings.cardsWithRank≈0 means the artifact stamp was skipped" : "add &live=1 to actually run the wallet scan and surface the real error",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
