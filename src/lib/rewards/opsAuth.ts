// MisFitz Rewards - operator-secret check (SERVER-ONLY; imports node:crypto). Constant-time compare over SHA-256
// digests so the comparison time never leaks the secret. Used by both the operator API route and the collection
// page's server-side ?ops gate. Returns false when the secret is unset or the candidate is missing.
import { createHash, timingSafeEqual } from "node:crypto";

export function opsSecretMatches(candidate: string | null | undefined): boolean {
  const secret = process.env.REWARDS_OPS_SECRET;
  if (!secret || !candidate) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
