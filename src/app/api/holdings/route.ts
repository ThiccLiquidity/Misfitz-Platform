import { NextResponse } from "next/server";
import { getMyHoldingsFast, pageRoster } from "@/lib/portfolio/myHoldings";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";
import { XCH_USD_FALLBACK } from "@/lib/market/dexie";

// Poll endpoint for big (whale) wallets. The binder page SSRs a first batch fast; if the wallet is still
// `warming`, the client polls here to RESUME paging until the full roster is loaded. Each call runs one
// bounded resume pass (the cursor + items-so-far are checkpointed server-side in Redis) and returns the
// current holdings plus `warming` (true = more pages remain, poll again).
export const dynamic = "force-dynamic";
export const maxDuration = 60; // one resume pass pages within a ~40s budget, then returns

export async function POST(req: Request) {
  let body: { addresses?: unknown; refresh?: unknown; have?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const raw = Array.isArray(body.addresses) ? body.addresses : [];
  const addresses = [
    ...new Set(
      raw.filter((a): a is string => typeof a === "string").map((a) => a.trim().toLowerCase()).filter(isValidChiaOwnerId),
    ),
  ].slice(0, 25); // bound: no one pastes 25+ wallets
  if (addresses.length === 0) return NextResponse.json({ error: "no valid addresses" }, { status: 400 });
  try {
    const holdings = await getMyHoldingsFast(addresses, { budgetMs: 20_000, fresh: body.refresh === true });
    // The roster TRANSFER must stay lightweight: a fully-stamped card (inline traits + value breakdown) can be
    // several KB, so 1200 of them blow past Vercel's ~4.5MB response cap and HARD-500 (the whole reply is
    // rejected -> the binder sticks at zero). Strip the heavy per-card trait arrays here; name/thumb/rank/value/
    // collection stay for immediate display, and traits backfill via the client's /api/binder enrichment exactly
    // as they already do for xch1 wallets. (Totals were computed over the full stamped set before this.)
    const lite = holdings.nfts.map((n) => ((n.traits?.length ?? 0) > 0 ? { ...n, traits: [] } : n));
    // Chunk the reply so a big roster stays under the cap. While warming we serve only the stable first chunk
    // (the roster is still growing); once complete we page by index from `have`. See pageRoster.
    const have = typeof body.have === "number" ? body.have : 0;
    const page = pageRoster(lite, holdings.warming, have);
    return NextResponse.json({ ...holdings, ...page }, { headers: { "cache-control": "no-store" } });
  } catch {
    // Degrade, never 500: report warming so the client keeps polling and the checkpointed scan resumes.
    return NextResponse.json(
      { nfts: [], totalEstimateXch: 0, totalEstimateUsd: 0, xchUsdRate: XCH_USD_FALLBACK, collections: [], addresses, truncated: false, warming: true, demo: false },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
