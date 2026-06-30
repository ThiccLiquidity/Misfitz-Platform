import { decodeChiaAddress } from "@/lib/chia/bech32";

// Client-safe owner-id helpers (no node:crypto, unlike message.ts) so both the server binder and the
// browser wallet manager share one validator. An "owner id" is an xch1 address OR a did:chia profile
// id — both bech32m; the binder resolves a collector's whole holdings from either.
export function isValidChiaOwnerId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const d = decodeChiaAddress(value.trim().toLowerCase());
  if (!d) return false;
  return d.hrp === "xch" || d.hrp.startsWith("did:chia");
}

// Pull every valid owner id out of free-form pasted text (split on whitespace/commas), lowercased
// and de-duplicated, preserving first-seen order. Invalid tokens are silently dropped.
export function parseOwnerIds(text: string): string[] {
  const seen = new Set<string>();
  for (const tok of text.split(/[\s,]+/)) {
    const v = tok.trim().toLowerCase();
    if (v && isValidChiaOwnerId(v)) seen.add(v);
  }
  return [...seen];
}
