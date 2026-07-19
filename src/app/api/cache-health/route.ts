import { NextResponse } from "next/server";
import { redisHealth, redisByteStats } from "@/lib/db/nftCache";
import { blobHealth, blobStats } from "@/lib/db/blobStore";

// Diagnostic endpoint: GET /api/cache-health -> JSON telling us whether the shared Redis (Upstash/Vercel-KV)
// layer is actually live in production. Safe: leaks no secrets (only the URL host + booleans). Calling it
// performs a real set+get, so a healthy response also bumps the Redis command counter.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const [redis, blob] = await Promise.all([redisHealth(), blobHealth()]);
  // blob.backend === "redis" means large blobs still use Upstash; "r2" means the zero-egress store is live.
  // A non-null blob.error with backend "r2" = misconfigured R2 (bad creds/bucket) silently degrading — fix it.
  return NextResponse.json({ ...redis, blob: { ...blob, stats: blobStats() }, redisBytesByPrefix: redisByteStats() }, { headers: { "cache-control": "no-store" } });
}
