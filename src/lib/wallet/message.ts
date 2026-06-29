import { randomBytes } from "node:crypto";

// How long a freshly issued challenge stays valid. Short on purpose — the user signs once,
// immediately. Single-use (WalletChallenge.consumedAt) together with this TTL defeats replay.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DOMAIN = "Misfitz Platform";

// 32 bytes of entropy, hex. Stored unique in WalletChallenge.nonce.
export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

// The exact string the wallet is asked to sign. Human-readable so the user can see in their
// wallet that they are proving address ownership, never authorizing a transaction. The nonce
// binds the signature to one challenge. Stored verbatim so verification reconstructs the
// identical payload.
export function buildChallengeMessage(params: { address: string; nonce: string; issuedAt: Date }): string {
  const { address, nonce, issuedAt } = params;
  return [
    `${DOMAIN} wants you to prove ownership of this Chia address.`,
    ``,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    ``,
    `Signing this message proves you control the address. It is not a transaction and moves no funds.`,
  ].join("\n");
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() > expiresAt.getTime();
}

// Loose client-facing check: human-readable prefix + bech32m charset + plausible length. True
// cryptographic binding (pubkey -> puzzle hash -> this exact address) is enforced by the
// verifier; this only catches obvious typos before we bother issuing a challenge.
const BECH32M_CHARSET = /^[ac-hj-np-z02-9]+$/; // bech32 excludes 1 b i o
export function isValidChiaAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  if (!v.startsWith("xch1")) return false;
  if (v.length < 40 || v.length > 130) return false;
  return BECH32M_CHARSET.test(v.slice(4));
}
