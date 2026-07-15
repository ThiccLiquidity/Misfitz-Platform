import { NextResponse } from "next/server";
import { listAddressNfts } from "@/lib/data-sources/mintgarden/client";
import { getMyHoldingsFast } from "@/lib/portfolio/myHoldings";
import { isValidChiaOwnerId } from "@/lib/wallet/ownerId";

// TEMP DIAGNOSTIC: GET /api/holdings/debug?address=xch1…|did:chia…
// Reproduces the wallet-load path in the PROD/PREVIEW runtime and reports exactly what happens, so we can tell
// "MintGarden unreachable in prod" apart from "our processing throws". Read-only, no secrets, never 500s (every
// failure is caught and returned as JSON with the error message). Safe to delete once the load path is fixed.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; result?: T; error?: string }> {
  const t = Date.now();
  try { const result = await fn(); return { ok: true, ms: Date.now() - t, result }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: String((e as Error)?.message ?? e) }; }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = (url.searchParams.get("address") || "").trim().toLowerCase();
  if (!address || !isValidChiaOwnerId(address)) return NextResponse.json({ error: "pass ?address=xch1… or did:chia…" }, { status: 400 });

  const out: Record<string, unknown> = {
    address,
    kind: address.startsWith("did:chia") ? "profile(DID)" : "address(xch1)",
    env: { node: process.version, hasRedis: !!(process.env.REDIS_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) },
    now: new Date().toISOString(),
  };

  // 1) One raw MintGarden page WITH inline metadata (what SSR/poll page-1 asks for).
  const withMeta = await timed(() => listAddressNfts(address, undefined, 50, "owned", true, false, true));
  out.rawWithMetadata = withMeta.ok
    ? { ok: true, ms: withMeta.ms, count: withMeta.result?.items?.length ?? 0, hasNext: !!withMeta.result?.next, firstName: withMeta.result?.items?.[0]?.name ?? null }
    : { ok: false, ms: withMeta.ms, error: withMeta.error };

  // 2) One raw page WITHOUT metadata (the fast retry path).
  const noMeta = await timed(() => listAddressNfts(address, undefined, 50, "owned", true, false, false));
  out.rawNoMetadata = noMeta.ok
    ? { ok: true, ms: noMeta.ms, count: noMeta.result?.items?.length ?? 0, hasNext: !!noMeta.result?.next, firstName: noMeta.result?.items?.[0]?.name ?? null }
    : { ok: false, ms: noMeta.ms, error: noMeta.error };

  // 3) The real entry point with a small budget — does it return items, warm empty, or throw?
  const holdings = await timed(() => getMyHoldingsFast([address], { budgetMs: 6_000, fresh: true }));
  out.getMyHoldingsFast = holdings.ok
    ? { ok: true, ms: holdings.ms, nfts: holdings.result?.nfts?.length ?? 0, warming: holdings.result?.warming, collections: holdings.result?.collections?.length ?? 0, truncated: holdings.result?.truncated }
    : { ok: false, ms: holdings.ms, error: holdings.error };

  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
