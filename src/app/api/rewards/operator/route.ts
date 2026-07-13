import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { readOperator } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";
import { opsSecretMatches } from "@/lib/rewards/opsAuth";

// OPERATOR-ONLY read of the SHADOW snapshot's operator actions (how much XCH to move where). Kept OUT of the
// public /api/rewards/snapshot so a normal visitor never sees it. Authed with REWARDS_OPS_SECRET, supplied as
// ?key= or an Authorization: Bearer header. Always 404s on a bad/missing key or when the flag is off, so the
// route is indistinguishable from nonexistent to anyone without the secret. no-store (never cache on the CDN).
export const dynamic = "force-dynamic";

function authorized(req: Request, url: URL): boolean {
  // Accept the secret from an Authorization: Bearer header (preferred) or a ?key= query param (manual curl).
  // Both go through a constant-time compare (opsSecretMatches). Missing secret -> always false.
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  return opsSecretMatches(token) || opsSecretMatches(url.searchParams.get("key"));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // A wrong/missing key is indistinguishable from a nonexistent route (same 404, no hint the feature exists).
  if (!isRewardsShadowEnabled() || !authorized(req, url)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const col = url.searchParams.get("col") || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ops = await readOperator(col).catch(() => null);
  if (!ops) return NextResponse.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json(ops, { headers: { "cache-control": "no-store" } });
}
