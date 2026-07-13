import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { readSnapshot } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";

// Public (flag-gated) read of the cached SHADOW snapshot. NEVER computes — only reads the blob the cron wrote.
// 404 when the flag is off (indistinguishable from a nonexistent route). Edge-cached: identical for everyone.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isRewardsShadowEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const col = new URL(req.url).searchParams.get("col") || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const snap = await readSnapshot(col).catch(() => null);
  if (!snap) return NextResponse.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json(snap, { headers: { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" } });
}
