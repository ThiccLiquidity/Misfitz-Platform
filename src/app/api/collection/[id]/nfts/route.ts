import { NextResponse } from "next/server";
import { getCollectionNftsPage } from "@/lib/collections/liveCollection";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!params.id || !params.id.startsWith("col1")) return NextResponse.json({ nfts: [], cursor: null });
  const cursor = (new URL(req.url).searchParams.get("cursor") ?? "").slice(0, 512); // bound opaque cursor
  if (!cursor) return NextResponse.json({ nfts: [], cursor: null });
  try {
    return NextResponse.json(await getCollectionNftsPage(params.id, cursor));
  } catch {
    return NextResponse.json({ nfts: [], cursor: null });
  }
}
