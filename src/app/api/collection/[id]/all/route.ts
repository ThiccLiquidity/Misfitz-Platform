import { NextResponse } from "next/server";
import { getAllCollectionCards, getCollectionRecentSales } from "@/lib/collections/liveCollection";
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
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    if (force) await forceCompsRefresh(params.id).catch(() => {});
    const r = await timed("collection.all", () => getAllCollectionCards(params.id, { forceIndex: force }));
    // Recent-sales feed: a pure join over already-cached Dexie sales + the cards we just loaded. No new fetch.
    const recentSales = await getCollectionRecentSales(params.id, r.nfts).catch(() => []);
    // User-agnostic, so let Vercel's EDGE cache serve repeat opens (~100ms, zero function) via s-maxage.
    // Don't pin a still-"warming" payload at the edge — serve those no-store so the warmed data appears next.
    const cache = r.warming || force
      ? "no-store"
      : "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";
    return NextResponse.json({ ...r, recentSales }, { headers: { "Cache-Control": cache } });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
