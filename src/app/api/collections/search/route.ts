import { NextResponse } from "next/server";
import { searchCollectionsByName } from "@/lib/collections/discovery";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const collections = await searchCollectionsByName(q);
  return NextResponse.json({ collections });
}
