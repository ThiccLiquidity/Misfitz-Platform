import { NextResponse } from "next/server";
import { fetchNftOffer } from "@/lib/market/dexie";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const nft = new URL(req.url).searchParams.get("nft") ?? "";
  if (!nft.startsWith("nft1")) return NextResponse.json({ offer: null });
  const result = await fetchNftOffer(nft);
  return NextResponse.json(result ?? { offer: null });
}
