import { NextResponse } from "next/server";
import { searchCollectionsByName } from "@/lib/collections/discovery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const collections = await searchCollectionsByName(q);
  // Search results are user-agnostic and cached ~5 min server-side; allow short shared caching.
  return NextResponse.json(
    { collections },
    { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" } },
  );
}
