import { NextResponse } from "next/server";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the first fetch of a big collection pages through everything

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!params.id || !params.id.startsWith("col1")) {
    return NextResponse.json({ error: "invalid collection id" }, { status: 400 });
  }
  try {
    const r = await getAllCollectionCards(params.id);
    // User-agnostic, so let Vercel's EDGE cache serve repeat opens (~100ms, zero function) via s-maxage.
    // Don't pin a still-"warming" payload at the edge — serve those no-store so the warmed data appears next.
    const cache = r.warming
      ? "no-store"
      : "public, max-age=60, s-maxage=120, stale-while-revalidate=600";
    return NextResponse.json(r, { headers: { "Cache-Control": cache } });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
