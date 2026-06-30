import { NextResponse } from "next/server";
import { getCollectionNftsPage } from "@/lib/collections/liveCollection";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const cursor = new URL(req.url).searchParams.get("cursor") ?? "";
  if (!cursor) return NextResponse.json({ nfts: [], cursor: null });
  const r = await getCollectionNftsPage(params.id, cursor);
  return NextResponse.json(r);
}
