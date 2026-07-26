// Auth level for the read-only diagnostic endpoints (/api/status, /api/cache-health).
//
// Design goal: harden them WITHOUT ever locking the operator out. These are the endpoints you reach for when
// production is misbehaving — a hard 404 on a missing secret is exactly the wrong failure mode at 2am. So:
//
//   secret configured + correct   -> "full"     : everything, including the infra host and the deep SCAN
//   secret configured + wrong     -> "reduced"  : still useful, but no host, no expensive scan
//   no secret configured at all   -> "reduced"  : same safe subset, always reachable
//
// "reduced" is the part that matters: it removes the two real problems the audit found — the leaked Upstash
// hostname / key breakdown, and the ability of an anonymous caller to drive metered work per request.
import { createHash, timingSafeEqual } from "node:crypto";

export type DiagLevel = "full" | "reduced";

export function diagLevel(req: Request): DiagLevel {
  // Any of these unlocks full detail; OPS_SECRET is the dedicated one, the others are accepted so an
  // existing deployment doesn't need a new variable just to keep the visibility it already had.
  const secret = process.env.OPS_SECRET || process.env.REWARDS_OPS_SECRET || process.env.CRON_SECRET;
  if (!secret) return "reduced";
  let candidate: string | null = null;
  try { candidate = new URL(req.url).searchParams.get("key"); } catch { /* malformed url */ }
  if (!candidate) candidate = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || null;
  if (!candidate) return "reduced";
  // Constant-time over SHA-256 digests (equal length by construction), same as opsAuth.
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? "full" : "reduced";
}
