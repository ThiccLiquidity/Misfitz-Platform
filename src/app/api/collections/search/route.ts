import { NextResponse } from "next/server";
import { searchCollectionsByName } from "@/lib/collections/discovery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120); // bound user input
  try {
    const collections = await searchCollectionsByName(q);
    return NextResponse.json({ collections }, { headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ collections: [] });
  }
}
