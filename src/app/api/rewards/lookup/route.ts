import { NextResponse } from "next/server";
import { isRewardsShadowEnabled } from "@/lib/rewards/flag";
import { readWalletValue } from "@/lib/rewards/snapshotJob";
import { MISFITZ_COLLECTION_ID } from "@/lib/rewards/consts";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";

// Per-wallet SHADOW lookup (flag-gated). Reads the private wallet map; no-store (per-wallet, don't pollute CDN).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isRewardsShadowEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const url = new URL(req.url);
  const col = url.searchParams.get("col") || MISFITZ_COLLECTION_ID;
  const wallet = (url.searchParams.get("wallet") || "").trim().toLowerCase();
  if (col !== MISFITZ_COLLECTION_ID) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!isValidChiaOwnerId(wallet)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const value = await readWalletValue(col, wallet).catch(() => null);
  return NextResponse.json({ wallet, value }, { headers: { "cache-control": "no-store" } });
}
