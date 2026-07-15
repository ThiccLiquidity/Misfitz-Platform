// MisFitz Rewards — payout MANIFEST tooling (PURE). Turns a computed epoch/drip into a canonical, hash-verified,
// immutable instruction set the operator's LOCAL bot consumes. Traitfolio only PUBLISHES manifests — it never
// signs or sends. The bot: verify hash -> verify guards -> dry-run -> operator confirm -> send -> record in the
// idempotency ledger so a re-run never double-pays. Amounts are strings (base units) so the hash is stable.

import { createHash } from "node:crypto";
import { type WalletPayout } from "./types";
import { type DripResult } from "./allocator";
import { isUnattributed } from "./settle";

export const ASSET_XCH = "xch";
export const CHIA_ASSET_ID = "69326954fe16117cd6250e929748b2a1ab916347598bc8180749279cfae21ddb"; // $CHIA reward CAT
export const TOKEN_TAIL_TBD = "TOKEN_TAIL_TBD"; // $TOKEN tail id — set once minted

export interface ManifestRecipient { wallet: string; assetId: string; amountUnits: string; reason: string }

export interface PayoutManifest {
  version: 1;
  kind: "reward" | "drip";
  epochId: string;
  collectionId?: string; // which collection this epoch belongs to. Optional for back-compat; when set it
                         // scopes the idempotency paymentKey so two collections sharing an epoch id can't collide.
  generatedAt: number;
  asset: { id: string; symbol: string; decimals: number };
  recipients: ManifestRecipient[];
  recipientCount: number;
  totalUnits: string;
  routedToBurnUnits?: string; // reward manifests: unattributed XCH diverted to burn (informational)
  notes: string[];
  provenance: "shadow" | "chain-verified"; // reward manifests need "chain-verified" before the bot will send
  hash: string;        // sha256 hex of the canonical serialization (all fields EXCEPT hash + signature)
  signature?: string;  // operator signature over `hash` (set by signManifest). REQUIRED before real payouts (see guard).
}

// Deterministic serialization: stable (sorted) object keys at every level; arrays preserve order (we sort the
// recipients explicitly before hashing). Numbers/strings via JSON.stringify. No floats on amounts (strings).
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort(); // drop undefined -> stable across a JSON round-trip
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export function hashManifest(m: Record<string, unknown>): string {
  const { hash: _h, signature: _s, ...body } = m as Record<string, unknown>; // never hash the hash or the signature
  void _h; void _s;
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

// Attach an operator signature over the hash. The bot MUST verify this (not just the hash) before any real send:
// the hash proves internal integrity, the signature proves the manifest came from the operator (see B1).
export function signManifest(m: PayoutManifest, sign: (hashHex: string) => string): PayoutManifest {
  return { ...m, signature: sign(m.hash) };
}

function sortRecipients(rs: ManifestRecipient[]): ManifestRecipient[] {
  return [...rs].sort((a, b) => (a.assetId === b.assetId ? (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0) : a.assetId < b.assetId ? -1 : 1));
}

function finalize(m: Omit<PayoutManifest, "hash" | "recipientCount" | "totalUnits">): PayoutManifest {
  const recipients = sortRecipients(m.recipients);
  const total = recipients.reduce((s, r) => s + BigInt(r.amountUnits), BigInt(0));
  const body = { ...m, recipients, recipientCount: recipients.length, totalUnits: total.toString() };
  return { ...body, hash: hashManifest(body) };
}

// $TOKEN drip manifest — fully deterministic (no market conversion). One recipient per wallet.
export function buildDripManifest(
  epochId: string,
  r: DripResult,
  generatedAt: number,
  opts: { symbol?: string; assetId?: string; decimals?: number; collectionId?: string } = {},
): PayoutManifest {
  const asset = { id: opts.assetId ?? TOKEN_TAIL_TBD, symbol: opts.symbol ?? "$TOKEN", decimals: opts.decimals ?? 3 };
  const recipients: ManifestRecipient[] = r.wallets
    .filter((w) => w.tokenUnits > BigInt(0))
    .map((w) => ({ wallet: w.wallet, assetId: asset.id, amountUnits: w.tokenUnits.toString(), reason: `drip:${w.nftCount}nft` }));
  return finalize({ version: 1, kind: "drip", epochId, collectionId: opts.collectionId, generatedAt, asset, recipients, provenance: "shadow", notes: [
    "Monthly $TOKEN drip. Deterministic (no conversion). Verify hash + guards, dry-run, confirm, then send.",
  ] });
}

// $CHIA reward manifest — built from the VERIFIED payouts (unattributed already routed to burn by settle) and
// the per-wallet $CHIA amounts from distributeChia (base units). Reason carries the pre-conversion XCH owed.
export function buildRewardManifest(
  epochId: string,
  payable: WalletPayout[],
  chiaPerWallet: Map<string, bigint>,
  generatedAt: number,
  routedToBurnMojos: bigint = BigInt(0),
  chiaAssetId: string = CHIA_ASSET_ID,
  provenance: "shadow" | "chain-verified" = "shadow",
  collectionId?: string,
): PayoutManifest {
  const asset = { id: chiaAssetId, symbol: "$CHIA", decimals: 3 };
  // Guard against mis-wiring: every $CHIA key must be a SETTLED, verified wallet. Passing the unsettled epoch
  // payouts (which still contain unknown-* placeholders, and where distributeChia may have parked dust on a
  // placeholder) would silently strand funds — throw instead.
  const payableWallets = new Set(payable.map((p) => p.wallet));
  for (const w of chiaPerWallet.keys()) {
    if (isUnattributed(w)) throw new Error(`buildRewardManifest: $CHIA assigned to unattributed wallet ${w} — run settleUnattributed first`);
    if (!payableWallets.has(w)) throw new Error(`buildRewardManifest: $CHIA wallet ${w} is not in the settled payable set`);
  }
  const recipients: ManifestRecipient[] = payable
    .filter((p) => !isUnattributed(p.wallet) && (chiaPerWallet.get(p.wallet) ?? BigInt(0)) > BigInt(0))
    .map((p) => ({ wallet: p.wallet, assetId: asset.id, amountUnits: (chiaPerWallet.get(p.wallet) as bigint).toString(), reason: `reward:owed ${p.total.toString()} mojos XCH` }));
  return finalize({ version: 1, kind: "reward", epochId, collectionId, generatedAt, asset, recipients, provenance,
    routedToBurnUnits: routedToBurnMojos.toString(),
    notes: [
      "$CHIA reward payout. Buy $CHIA with the reward pot FIRST, then this manifest splits the ACTUAL received.",
      "Unattributed rewards were routed to burn (see routedToBurnUnits) and are NOT in this recipient list.",
    ],
  });
}

// Human-readable dry-run of exactly what the bot WOULD send.
export function formatManifest(m: PayoutManifest, limit = 20): string {
  const L: string[] = [];
  L.push(`=== Payout manifest [${m.kind}] epoch ${m.epochId} ===`);
  L.push(`asset ${m.asset.symbol} (${m.asset.id})`);
  L.push(`recipients ${m.recipientCount} · total ${m.totalUnits} base units`);
  if (m.routedToBurnUnits && m.routedToBurnUnits !== "0") L.push(`routed to burn (unattributed): ${m.routedToBurnUnits} mojos XCH`);
  L.push(`hash ${m.hash}`);
  for (const r of m.recipients.slice(0, limit)) L.push(`  ${r.wallet.padEnd(14)} ${r.amountUnits.padStart(16)}  ${r.reason}`);
  if (m.recipients.length > limit) L.push(`  … +${m.recipients.length - limit} more`);
  return L.join("\n");
}
