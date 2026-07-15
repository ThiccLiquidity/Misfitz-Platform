import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { computeRewardsSnapshot, readSettlementDoc } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";
import { opsSecretMatches } from "@/lib/rewards/opsAuth";
import { advanceEpoch, readEpochState } from "@/lib/rewards/epochRegistry";

// OPERATOR-ONLY: manually CLOSE an epoch. Runs the pipeline once with status:"final" at the current time
// (payoutAt = now inside computeRewardsSnapshot), freezes the settlement document, and records the epoch as
// "closed". Operator-triggered — NOT a cron date. Authed with REWARDS_OPS_SECRET; 404s on bad key / flag off.
// Moves no funds — it only computes and freezes the numbers. Re-closing an already-paid epoch is refused.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request, url: URL): boolean {
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  return opsSecretMatches(token) || opsSecretMatches(url.searchParams.get("key"));
}

// month index since the configured launch month (REWARDS_LAUNCH=YYYY-MM); 1 when unset (shadow placeholder).
function dripMonthFor(epoch: string): number {
  const launch = process.env.REWARDS_LAUNCH;
  if (!launch || !/^\d{4}-\d{2}$/.test(launch)) return 1;
  const [ly, lm] = launch.split("-").map(Number);
  const [ey, em] = epoch.split("-").map(Number);
  return Math.max(1, (ey - ly) * 12 + (em - lm) + 1);
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!isRewardsShadowEnabled() || !authorized(req, url)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const col = (typeof body.col === "string" && body.col) || MISFITZ_COLLECTION_ID;
  // Default: close the PREVIOUS calendar month (the just-finished epoch). Operator may pass epoch=YYYY-MM.
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1);
  const epoch = (typeof body.epoch === "string" && /^\d{4}-\d{2}$/.test(body.epoch)) ? body.epoch
    : `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  const existing = await readEpochState(col, epoch).catch(() => null);
  if (existing?.status === "paid") return NextResponse.json({ error: "epoch already paid — cannot re-close", epoch }, { status: 409 });

  const [ey, em] = epoch.split("-").map(Number);
  const epochStart = Date.UTC(ey, em - 1, 1);
  const epochEnd = Date.UTC(ey, em, 1);
  const res = await computeRewardsSnapshot(col, {
    epochStart, epochEnd, epoch, status: "final", dripMonth: dripMonthFor(epoch), updatePointer: false,
  }).catch((e) => ({ ok: false, status: String((e as Error)?.message ?? e) }));

  if (!res.ok) return NextResponse.json({ ok: false, epoch, compute: res }, { status: 200, headers: { "cache-control": "no-store" } });

  const doc = await readSettlementDoc(col, epoch).catch(() => null);
  const state = await advanceEpoch(col, epoch, "closed", { closedAt: Date.now(), closedPayoutAt: Date.now(), recipientListHash: doc?.recipientListHash })
    .catch(() => null);

  return NextResponse.json({
    ok: true, epoch, status: state?.status ?? "closed",
    computeStatus: res.status,
    recipientListHash: doc?.recipientListHash ?? null,
    move: doc?.move ?? null,
    truncated: doc?.truncated ?? null,
    hint: "GET /api/rewards/manifest?col&epoch&download=1 to download the settlement document.",
  }, { headers: { "cache-control": "no-store" } });
}
