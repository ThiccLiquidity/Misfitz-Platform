import { NextResponse } from "next/server";
import { getAllCollectionCards } from "@/lib/collections/liveCollection";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the first fetch of a big collection pages through everything

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = await getAllCollectionCards(params.id);
  // Response is user-agnostic and backed by a ~10 min server cache, so let the browser/CDN reuse it
  // briefly and serve stale while revalidating — repeat views skip the handler entirely.
  return NextResponse.json(r, {
    headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
  });
}
