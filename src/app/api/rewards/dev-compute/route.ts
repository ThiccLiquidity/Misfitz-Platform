import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { computeRewardsSnapshot } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";

// DEV-ONLY helper: compute + persist this month's SHADOW snapshot on demand, so you can eyeball the dashboard
// locally without wiring the CRON_SECRET. Triple-gated and CANNOT run in production:
//   1) NODE_ENV must not be "production" (npm run dev only; npm start sets production -> hard 404),
//   2) the REWARDS_SHADOW flag must be on,
//   3) only the MisFitz collection.
// Never ships behavior to prod; the cron (/api/rewards/cron) remains the real, authed path.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthStartMs = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

export async function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isRewardsShadowEnabled()) return NextResponse.json({ error: "REWARDS_SHADOW is off" }, { status: 404 });
  const now = new Date();
  const epoch = ym(now);
  const res = await computeRewardsSnapshot(MISFITZ_COLLECTION_ID, {
    epochStart: monthStartMs(now), epochEnd: now.getTime(), epoch, status: "mtd", dripMonth: 1,
  }).catch((e) => ({ ok: false, status: String((e as Error)?.message ?? e) }));
  return NextResponse.json({ epoch, ...res }, { headers: { "cache-control": "no-store" } });
}
