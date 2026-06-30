import { NextResponse } from "next/server";
import { getMyHoldingsFull, } from "@/lib/portfolio/myHoldings";
import { enrichNftsByIds } from "@/lib/portfolio/service";
import { isValidChiaOwnerId } from "@/lib/wallet/message";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";

// Enrichment endpoint for the progressive binder: returns the FULL holdings (per-NFT traits +
// our estimated ranks + refined values). The binder grid renders instantly from the fast path,
// then calls this in the background and merges the richer data in.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("address") ?? "").trim().toLowerCase();
  const addresses = raw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => isValidChiaOwnerId(a));
  if (addresses.length === 0) return NextResponse.json({ nfts: [] });

  const holdings = await getMyHoldingsFull(addresses);
  return NextResponse.json({
    nfts: holdings.nfts,
    totalEstimateXch: holdings.totalEstimateXch,
    totalEstimateUsd: holdings.totalEstimateUsd,
    truncated: holdings.truncated,
  });
}

// Batched enrichment for the progress bar: the client posts a chunk of NFT ids + the floors it
// already resolved, and we return the enriched cards for just those ids. Cached detail fetches make
// repeat chunks fast.
export async function POST(req: Request) {
  let body: { ids?: string[]; floors?: Record<string, number>; xchUsdRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ nfts: [] });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : [];
  const floors = body.floors && typeof body.floors === "object" ? body.floors : {};
  const rate = typeof body.xchUsdRate === "number" ? body.xchUsdRate : XCH_USD_FALLBACK;
  if (ids.length === 0) return NextResponse.json({ nfts: [] });
  const nfts = await enrichNftsByIds(ids, floors, rate);
  return NextResponse.json({ nfts });
}
