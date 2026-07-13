// MisFitz Rewards - PURE identity helpers (no imports beyond a type). Split out from identity.ts so they can be
// unit-tested without loading the MintGarden client / Redis graph. These also SANITIZE MintGarden-supplied
// strings, which are attacker-influenced: anyone who reaches a leaderboard controls their own profile name/avatar.
import type { LeaderIdentity } from "./snapshotTypes";

const NAME_MAX = 40;

// Codepoint ranges to strip: C0 controls, C1 controls, zero-width/bidi marks, bidi overrides, isolates, BOM.
// Expressed as decimal so the source stays plain ASCII (no literal invisible characters to corrupt the file).
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff],
];
function isUnsafeCode(c: number): boolean {
  return UNSAFE_RANGES.some(([lo, hi]) => c >= lo && c <= hi);
}

// Opt-out list from env: comma/space separated wallets or DIDs. Case-insensitive. Someone who uses BOTH an
// xch1 address AND a did:chia should list BOTH forms (leaderboards key holders by address, traders by DID).
export function parseOptOut(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// Strip control + bidi/zero-width chars, collapse whitespace, cap length. Empty result -> null so the UI's
// truthiness check falls back to the truncated address.
export function sanitizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  let out = "";
  for (const ch of name) {
    const c = ch.codePointAt(0);
    if (c != null && !isUnsafeCode(c)) out += ch;
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > NAME_MAX ? cleaned.slice(0, NAME_MAX) : cleaned;
}

// Only allow https URLs on MintGarden's asset CDN - the one place MintGarden serves profile avatars. Anything
// else (arbitrary host, http, javascript:, data:) is dropped so a leaderboard wallet can't point every visitor's
// browser at an attacker server (tracking pixel / IP harvest), serve mixed content, or swap in offensive imagery.
export function sanitizeAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "https:") return null;
    if (!/(^|\.)mintgarden\.io$/i.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch { return null; }
}

// Normalize a resolved name/avatar into a sanitized LeaderIdentity, blanking it entirely if the wallet opted out.
export function identityOrOptOut(wallet: string, name: string | null | undefined, avatarUrl: string | null | undefined, optOut: Set<string>): LeaderIdentity {
  if (optOut.has(wallet.trim().toLowerCase())) return { name: null, avatarUrl: null };
  return { name: sanitizeName(name), avatarUrl: sanitizeAvatar(avatarUrl) };
}
