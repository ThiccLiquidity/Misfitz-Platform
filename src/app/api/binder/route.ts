import { NextResponse } from "next/server";
import { getMyHoldingsFull } from "@/lib/portfolio/myHoldings";
import { isValidChiaAddress } from "@/lib/wallet/message";

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
    .filter((a) => isValidChiaAddress(a));
  if (addresses.length === 0) return NextResponse.json({ nfts: [] });

  const holdings = await getMyHoldingsFull(addresses);
  return NextResponse.json({
    nfts: holdings.nfts,
    totalEstimateXch: holdings.totalEstimateXch,
    totalEstimateUsd: holdings.totalEstimateUsd,
    truncated: holdings.truncated,
  });
}
