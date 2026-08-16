import { NextResponse } from "next/server";
import { getAllCollectionCards, getCollectionRecentSales } from "@/lib/collections/liveCollection";
import { projectCollectionWire } from "@/lib/collections/collectionWire";
import { forceCompsRefresh } from "@/lib/valuation/compsService";
import { timed } from "@/lib/perf/timing";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the first fetch of a big collection pages through everything

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!params.id || !params.id.startsWith("col1")) {
    return NextResponse.json({ error: "invalid collection id" }, { status: 400 });
  }
  try {
    // ?refresh=1 — manual bust: refit comps from a live Dexie pull first, then serve values computed from
    // the fresh model (forceIndex also force-writes the value index so the wallet binder converges too).
    // Cheap to expose: the comps build lock makes concurrent/hammered refreshes collapse into one build.
    const qs = new URL(req.url).searchParams;
    const force = qs.get("refresh") === "1";
    // ?v=2 -> COMPACT WIRE (collectionWire.ts): ~13.7MB -> ~2MB for a 10k collection, and JSON.parse gets a
    // 2MB string instead of a 14MB one. OPT-IN by the client so a browser tab still running the PREVIOUS
    // deploy's JS keeps receiving the shape it understands. It must be a query param, not a header: the
    // query string is part of Vercel's edge cache key, so the two shapes can never be served from each
    // other's cached entry (a header would need Vary, which fragments the edge cache).
    const wireV2 = qs.get("v") === "2";
    if (force) await forceCompsRefresh(params.id).catch(() => {});
    const r = await timed("collection.all", () => getAllCollectionCards(params.id, { forceIndex: force }));
    // Recent-sales feed: a pure join over already-cached Dexie sales + the cards we just loaded. No new fetch.
    const recentSales = await getCollectionRecentSales(params.id, r.nfts).catch(() => []);
    // User-agnostic, so let Vercel's EDGE cache serve repeat opens (~100ms, zero function) via s-maxage.
    // Don't pin a still-"warming" payload at the edge — serve those no-store so the warmed data appears next.
    // An EMPTY recent-sales rail must NOT get pinned at the edge for 30min/24h either: on a cold origin the
    // `sales:{col}` blob can still be warming when this first serves, and the long s-maxage then froze a
    // sale-less payload (the "recent sales don't show up like they used to" regression). Serve empties with
    // a short edge window so the next open reconverges once the sales blob is warm.
    // A "warming" payload used to be no-store, which meant EVERY poll from EVERY viewer was a full origin
    // invocation re-running the 5-7 large-blob reads — and re-sending the whole ~13MB body. On a cold Misfitz
    // open with a 12-poll backoff that is the single biggest cause of "slow AF on mobile" AND of the Upstash
    // bandwidth spikes. A 15s edge window is shorter than the fastest client poll (4.3s x growth resets), so
    // the warmed data still appears on the next poll, but N concurrent viewers now collapse onto one build.
    const cache = force
      ? "no-store"
      : r.warming
      ? "public, max-age=0, s-maxage=15, stale-while-revalidate=60"
      : recentSales.length === 0
        ? "public, max-age=30, s-maxage=120, stale-while-revalidate=600"
        : "public, max-age=60, s-maxage=1800, stale-while-revalidate=86400"; // 30min edge — big cut to cold-origin roster/rarity/comps blob reads; values still converge via /api/values
    const body = wireV2
      ? projectCollectionWire(
          { nfts: r.nfts, total: r.total, capped: r.capped, hotTraits: r.hotTraits, warming: r.warming, valuesAsOf: r.valuesAsOf, floorXch: r.floorXch, xchUsdRate: r.xchUsdRate },
          recentSales,
        )
      : { ...r, recentSales };
    return NextResponse.json(body, { headers: { "Cache-Control": cache } });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
