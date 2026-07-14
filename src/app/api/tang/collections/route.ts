import { NextResponse } from "next/server";
import { getTangCollections } from "@/lib/tang/tangCollections";

// All Tang Gang collections as browse summaries (sorted by peel points). Public community data; cached hard.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const collections = await getTangCollections().catch(() => []);
  return NextResponse.json({ collections }, { headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } });
}
