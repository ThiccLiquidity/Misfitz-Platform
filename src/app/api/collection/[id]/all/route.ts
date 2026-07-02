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
    // User-agnostic + ~10 min server cache: allow brief browser/CDN reuse, stale-while-revalidate.
    return NextResponse.json(r, { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
