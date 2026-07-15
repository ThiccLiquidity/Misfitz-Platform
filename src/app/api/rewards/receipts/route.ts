import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";
import { opsSecretMatches } from "@/lib/rewards/opsAuth";
import { recordReceipts, readEpochState, type Receipt } from "@/lib/rewards/epochRegistry";

// OPERATOR/BOT-ONLY: the local bot posts receipts back after it broadcasts a payout, flipping the epoch to
// "paid" and recording the tx ids for the dashboard. Authed with REWARDS_OPS_SECRET (the bot holds the same
// secret). 404s on bad key / flag off. Records only — never sends. GET returns the current epoch state.
export const dynamic = "force-dynamic";

function authorized(req: Request, url: URL): boolean {
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  return opsSecretMatches(token) || opsSecretMatches(url.searchParams.get("key"));
}

function parseReceipts(raw: unknown): Receipt[] {
  if (!Array.isArray(raw)) return [];
  const out: Receipt[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.txId !== "string" || !o.txId) continue;
    out.push({
      kind: o.kind === "drip" ? "drip" : "reward",
      txId: o.txId,
      recipientCount: typeof o.recipientCount === "number" ? o.recipientCount : 0,
      totalUnits: typeof o.totalUnits === "string" ? o.totalUnits : "0",
      assetId: typeof o.assetId === "string" ? o.assetId : "",
      at: typeof o.at === "number" ? o.at : Date.now(),
    });
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isRewardsShadowEnabled() || !authorized(req, url)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const col = url.searchParams.get("col") || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const epoch = url.searchParams.get("epoch");
  if (!epoch) return NextResponse.json({ error: "epoch required" }, { status: 400 });
  const state = await readEpochState(col, epoch).catch(() => null);
  return NextResponse.json(state ?? { status: "open", epochId: epoch, collectionId: col }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (!isRewardsShadowEnabled() || !authorized(req, url)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const col = (typeof body.col === "string" && body.col) || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const epoch = typeof body.epoch === "string" ? body.epoch : null;
  if (!epoch || !/^\d{4}-\d{2}$/.test(epoch)) return NextResponse.json({ error: "valid epoch (YYYY-MM) required" }, { status: 400 });
  const receipts = parseReceipts(body.receipts);
  if (!receipts.length) return NextResponse.json({ error: "no valid receipts" }, { status: 400 });
  // Receipts only make sense after the epoch was closed + its manifest generated — guards against a stray bot
  // POST poisoning an open epoch to "paid" (monotonic = can't undo).
  const prior = await readEpochState(col, epoch).catch(() => null);
  if (!prior || (prior.status !== "closed" && prior.status !== "manifest"))
    return NextResponse.json({ error: "epoch not closed — nothing to record receipts against", epoch, status: prior?.status ?? "open" }, { status: 409 });
  const state = await recordReceipts(col, epoch, receipts).catch(() => null);
  return NextResponse.json({ ok: Boolean(state), epoch, status: state?.status ?? null, receiptCount: state?.receipts?.length ?? 0 }, { headers: { "cache-control": "no-store" } });
}
