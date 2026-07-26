import { NextResponse } from "next/server";
import { redisHealth, redisByteStats } from "@/lib/db/nftCache";
import { blobHealth, blobStats } from "@/lib/db/blobStore";
import { diagLevel } from "@/lib/ops/diagAuth";

// Diagnostic endpoint: GET /api/cache-health -> JSON telling us whether the shared Redis (Upstash/Vercel-KV)
// layer is actually live in production. Safe: leaks no secrets (only the URL host + booleans). Calling it
// performs a real set+get, so a healthy response also bumps the Redis command counter.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The probe is a REAL Redis set+get AND a real R2 put+get, so an unauthenticated caller could bill you per
// request just by refreshing. Memoised for 60s: still live enough to watch a deploy, no longer a free lever
// on your metered storage. An operator can force a fresh probe with ?key=<secret>&fresh=1.
const PROBE_TTL_MS = 60_000;
let _probe: { at: number; redis: Awaited<ReturnType<typeof redisHealth>>; blob: Awaited<ReturnType<typeof blobHealth>> } | null = null;

export async function GET(req: Request) {
  const full = diagLevel(req) === "full";
  const forceFresh = full && new URL(req.url).searchParams.get("fresh") === "1";
  if (!forceFresh && _probe && Date.now() - _probe.at < PROBE_TTL_MS) {
    const { redis, blob } = _probe;
    return NextResponse.json(
      { ...redis, urlHost: full ? redis.urlHost : null, cachedProbeAgeMs: Date.now() - _probe.at,
        blob: { ...blob, error: full ? blob.error : blob.error ? "(hidden)" : null, stats: blobStats() },
        redisBytesByPrefix: redisByteStats() },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const [redis, blob] = await Promise.all([redisHealth(), blobHealth()]);
  _probe = { at: Date.now(), redis, blob };
  // blob.backend === "redis" means large blobs still use Upstash; "r2" means the zero-egress store is live.
  // A non-null blob.error with backend "r2" = misconfigured R2 (bad creds/bucket) silently degrading — fix it.
  return NextResponse.json(
    { ...redis, urlHost: full ? redis.urlHost : null, cachedProbeAgeMs: 0,
      blob: { ...blob, error: full ? blob.error : blob.error ? "(hidden)" : null, stats: blobStats() },
      redisBytesByPrefix: redisByteStats() },
    { headers: { "cache-control": "no-store" } },
  );
}
