import { NextResponse } from "next/server";
import { getMyHoldingsFast } from "@/lib/portfolio/myHoldings";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";

// Poll endpoint for big (whale) wallets. The binder page SSRs a first batch fast; if the wallet is still
// `warming`, the client polls here to RESUME paging until the full roster is loaded. Each call runs one
// bounded resume pass (the cursor + items-so-far are checkpointed server-side in Redis) and returns the
// current holdings plus `warming` (true = more pages remain, poll again).
export const dynamic = "force-dynamic";
export const maxDuration = 60; // one resume pass pages within a ~40s budget, then returns

export async function POST(req: Request) {
  let body: { addresses?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const raw = Array.isArray(body.addresses) ? body.addresses : [];
  const addresses = [
    ...new Set(
      raw.filter((a): a is string => typeof a === "string").map((a) => a.trim().toLowerCase()).filter(isValidChiaOwnerId),
    ),
  ].slice(0, 25); // bound: no one pastes 25+ wallets
  if (addresses.length === 0) return NextResponse.json({ error: "no valid addresses" }, { status: 400 });
  const holdings = await getMyHoldingsFast(addresses, { budgetMs: 30_000 });
  return NextResponse.json(holdings, { headers: { "cache-control": "no-store" } });
}
