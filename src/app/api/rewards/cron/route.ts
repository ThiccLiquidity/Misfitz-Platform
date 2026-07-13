import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { computeRewardsSnapshot, readSnapshotFor } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";

// SHADOW rewards compute cron (Vercel Cron; see vercel.json). Computes the month-to-date snapshot every run and,
// on the 1st/2nd UTC, writes the PREVIOUS month's FINAL snapshot once. Flag-gated: a no-op (zero Redis work)
// when REWARDS_SHADOW is off. CRON_SECRET required (same as /api/warm). Never publicly triggerable.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthStartMs = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);

function dripMonthFor(epoch: string): number {
  const launch = process.env.REWARDS_LAUNCH;
  if (!launch || !/^\d{4}-\d{2}$/.test(launch)) return 1; // no launch set -> month 1 (shadow placeholder)
  const [ly, lm] = launch.split("-").map(Number);
  const [ey, em] = epoch.split("-").map(Number);
  return Math.max(1, (ey - ly) * 12 + (em - lm) + 1);
}

export async function GET(req: Request) {
  if (!isRewardsShadowEnabled()) return NextResponse.json({ ok: true, disabled: true }); // no work, no Redis
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const col = MISFITZ_COLLECTION_ID;
  const results: Record<string, unknown> = {};

  // Month-to-date (always)
  const mtdEpoch = ym(now);
  results.mtd = await computeRewardsSnapshot(col, {
    epochStart: monthStartMs(now), epochEnd: now.getTime(), epoch: mtdEpoch, status: "mtd", dripMonth: dripMonthFor(mtdEpoch),
  }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));

  // First two UTC days: write the previous month's FINAL once (don't overwrite an existing final).
  if (now.getUTCDate() <= 2) {
    const prev = new Date(monthStartMs(now) - 1);
    const prevEpoch = ym(prev);
    // Read the PREVIOUS month's blob DIRECTLY (not via the pointer, which the MTD write above just moved to the
    // current month). Write the final at most once, and do NOT move "latest" — the running MTD stays newest.
    const prevFinal = await readSnapshotFor(col, prevEpoch).catch(() => null);
    if (prevFinal?.status === "final") results.final = { skipped: "already final" };
    else {
      results.final = await computeRewardsSnapshot(col, {
        epochStart: monthStartMs(prev), epochEnd: monthStartMs(now), epoch: prevEpoch, status: "final", dripMonth: dripMonthFor(prevEpoch), updatePointer: false,
      }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    }
  }

  return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
}
