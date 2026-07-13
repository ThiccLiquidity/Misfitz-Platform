import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { readLpSnapshot } from "@/lib/rewards/lpJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";

// Public (flag-gated) read of the cached SHADOW LP-rewards snapshot. NEVER computes. 404 when the flag is off.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isRewardsShadowEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const col = new URL(req.url).searchParams.get("col") || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const snap = await readLpSnapshot(col).catch(() => null);
  if (!snap) return NextResponse.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json(snap, { headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" } });
}
