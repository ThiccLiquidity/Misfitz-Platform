import { NextResponse } from "next/server";
import { enrichNftsByIds } from "@/lib/portfolio/service";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";

// Batched enrichment for the progressive binder: the client POSTs a chunk of NFT ids + the floors it
// already resolved, and we return the enriched cards for just those ids. Cached detail fetches make
// repeat chunks fast.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { ids?: string[]; floors?: Record<string, number>; xchUsdRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ nfts: [] });
  }
  const ids = (Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : []).slice(0, 120); // bound payload
  const floors = body.floors && typeof body.floors === "object" ? body.floors : {};
  const rate = typeof body.xchUsdRate === "number" ? body.xchUsdRate : XCH_USD_FALLBACK;
  if (ids.length === 0) return NextResponse.json({ nfts: [] });
  const nfts = await enrichNftsByIds(ids, floors, rate);
  return NextResponse.json({ nfts });
}
