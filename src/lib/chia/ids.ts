// Shape validators for on-chain Chia ids that arrive from UNTRUSTED input (query strings, POST bodies).
//
// Why this exists: several public routes accepted any string that merely started with "col1"/"nft1" and
// then dispatched real upstream work per id — a full collection scan, or 3 retry attempts x 6s against
// MintGarden. 120 junk ids was enough to consume an entire 60s serverless function and issue 360 upstream
// requests, from one unauthenticated POST. A cheap shape check up front makes that class of amplification
// impossible before any network call is made.
//
// This is a SHAPE check, not a checksum — decodeChiaAddress() in ./bech32 is the real validator for owner
// ids. Here we only need "this could plausibly be an on-chain id" so junk never reaches the network.
// Deliberately a little loose on length so a future id-length change doesn't silently 404 real collections.

const BECH32_CHARS = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const COL_RE = new RegExp(`^col1[${BECH32_CHARS}]{40,80}$`);
const NFT_RE = new RegExp(`^nft1[${BECH32_CHARS}]{40,80}$`);

export function isCollectionId(v: unknown): v is string {
  return typeof v === "string" && COL_RE.test(v);
}

export function isNftId(v: unknown): v is string {
  return typeof v === "string" && NFT_RE.test(v);
}

// A price/floor supplied by a client is only usable if it's a real, sane number. NaN and Infinity both
// survive `typeof x === "number"` and propagate straight into the valuation math.
export function isSaneAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9;
}
