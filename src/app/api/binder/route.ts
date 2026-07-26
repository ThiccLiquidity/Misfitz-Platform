import { NextResponse } from "next/server";
import { enrichNftsByIds } from "@/lib/portfolio/service";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";
import { timed } from "@/lib/perf/timing";
import { isNftId, isSaneAmount } from "@/lib/chia/ids";

// Batched enrichment for the progressive binder: the client POSTs a chunk of NFT ids + the floors it
// already resolved, and we return the enriched cards for just those ids. Cached detail fetches make
// repeat chunks fast.
export const dynamic = "force-dynamic";
export const maxDuration = 60; // a kicked comps build must be able to finish + persist, not die with the request

// Local alias so the floors filter reads clearly; seeds/mock slugs are not valid floor keys here.
function isCollectionIdSafe(k: string): boolean {
  return /^col1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{40,80}$/.test(k);
}

export async function POST(req: Request) {
  let body: { ids?: string[]; floors?: Record<string, number>; xchUsdRate?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ nfts: [] });
  }
  // Ids are SHAPE-VALIDATED, not just typed. 120 arbitrary strings all missed the cache and each ran the
  // 3-attempt x 6s retry loop against MintGarden - ~208s of work dispatched by one unauthenticated POST,
  // killed at maxDuration having achieved nothing, after 360 upstream requests on the unpaced lane.
  const ids = (Array.isArray(body.ids) ? body.ids.filter(isNftId) : []).slice(0, 120); // bound payload
  // Client-supplied floors feed the valuation anchor directly; NaN/Infinity/negatives all passed a bare
  // typeof check and produced null or absurd estimates.
  const rawFloors = body.floors && typeof body.floors === "object" ? body.floors : {};
  const floors: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawFloors)) if (isCollectionIdSafe(k) && isSaneAmount(v)) floors[k] = v;
  const rate = typeof body.xchUsdRate === "number" ? body.xchUsdRate : XCH_USD_FALLBACK;
  if (ids.length === 0) return NextResponse.json({ nfts: [] });
  const nfts = await timed("binder.enrich", () => enrichNftsByIds(ids, floors, rate));
  return NextResponse.json({ nfts });
}
