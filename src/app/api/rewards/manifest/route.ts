import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { readSettlementDoc, latestEpochId } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";
import { opsSecretMatches } from "@/lib/rewards/opsAuth";
import { advanceEpoch } from "@/lib/rewards/epochRegistry";

// OPERATOR-ONLY: download the SINGLE combined settlement document for an epoch (XCH move breakdown + $SNACKZ drip
// + full per-wallet table + recipient-list hash). This is the artifact the operator hands to the local bot.
// Authed with REWARDS_OPS_SECRET; 404s on a bad/missing key or flag off (indistinguishable from nonexistent).
// Downloading records the epoch as "manifest" (with the hash) so the dashboard shows it's been pulled.
export const dynamic = "force-dynamic";

function authorized(req: Request, url: URL): boolean {
  const bearer = req.headers.get("authorization");
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : null;
  return opsSecretMatches(token) || opsSecretMatches(url.searchParams.get("key"));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isRewardsShadowEnabled() || !authorized(req, url)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const col = url.searchParams.get("col") || MISFITZ_COLLECTION_ID;
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  const epoch = url.searchParams.get("epoch") || (await latestEpochId(col));
  if (!epoch) return NextResponse.json({ status: "pending", detail: "no epoch computed yet" }, { headers: { "cache-control": "no-store" } });

  const doc = await readSettlementDoc(col, epoch).catch(() => null);
  if (!doc) return NextResponse.json({ status: "pending", epoch, detail: "settlement document not computed" }, { headers: { "cache-control": "no-store" } });
  // Only a CLOSED (final) epoch's doc is downloadable — never a still-moving month-to-date preview, whose numbers
  // the daily cron keeps overwriting. Close the epoch first (POST /api/rewards/close).
  if (doc.status !== "final") return NextResponse.json({ status: "pending", epoch, detail: "epoch not closed — POST /api/rewards/close first" }, { headers: { "cache-control": "no-store" } });

  // Mark it downloaded (monotonic; won't move a paid epoch backward). Best-effort — never block the download.
  await advanceEpoch(col, epoch, "manifest", { manifestAt: Date.now(), recipientListHash: doc.recipientListHash }).catch(() => {});

  const download = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = { "cache-control": "no-store" };
  if (download) headers["content-disposition"] = `attachment; filename="settlement-${col.slice(0, 10)}-${epoch}.json"`;
  return new NextResponse(JSON.stringify(doc, null, 2), { headers: { ...headers, "content-type": "application/json" } });
}
