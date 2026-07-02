import { NextResponse } from "next/server";
import { fetchNftOffer } from "@/lib/market/dexie";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const nft = new URL(req.url).searchParams.get("nft") ?? "";
  if (!nft.startsWith("nft1") || nft.length > 120) return NextResponse.json({ offer: null });
  try {
    return NextResponse.json((await fetchNftOffer(nft)) ?? { offer: null });
  } catch {
    return NextResponse.json({ offer: null });
  }
}
