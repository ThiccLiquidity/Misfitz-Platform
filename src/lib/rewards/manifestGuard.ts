// MisFitz Rewards — manifest GUARD + idempotency LEDGER (PURE). The LAST line before real sends, so it trusts
// as little as possible: it re-derives the hash AND (when a verifier is supplied) checks the operator SIGNATURE
// — the hash proves integrity, the signature proves the manifest is really the operator's. It validates the
// version/kind/asset semantics, enforces a wallet ALLOWLIST (not a placeholder denylist), forbids repeats,
// and requires a funding cap for reward payouts. The ledger keys every payment WITH its amount so a re-run
// after amounts change is caught (never a silent under/double-pay).

import { hashManifest, TOKEN_TAIL_TBD, type PayoutManifest, type ManifestRecipient } from "./manifest";

// A valid payout destination: a Chia bech32m address or a Chia DID. This subsumes the unattributed-placeholder
// check (unknown-*, empty, garbage all fail) — an allowlist can't silently rot when detection adds a variant.
const WALLET_RE = /^(xch1[0-9a-z]{40,}|did:chia:[0-9a-z]+)$/; // lowercase bech32m / DID only

export interface VerifyOptions {
  allowedAssets: string[];
  kind?: "reward" | "drip";
  fundingCapUnits?: bigint;
  maxRecipientShareBps?: number;
  hardRecipientShareBps?: number;
  allowPlaceholderAsset?: boolean;
  verifySignature?: (hashHex: string, signature: string) => boolean;
}

export interface VerifyResult { ok: boolean; errors: string[]; warnings: string[] }

export function verifyManifest(m: PayoutManifest, opts: VerifyOptions): VerifyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const Z = BigInt(0);

  if (m.version !== 1) errors.push(`unsupported version: ${String(m.version)}`);
  if (m.kind !== "reward" && m.kind !== "drip") errors.push(`unknown kind: ${String(m.kind)}`);
  if (opts.kind && m.kind !== opts.kind) errors.push(`kind mismatch: expected ${opts.kind}, got ${m.kind}`);

  if (hashManifest(m as unknown as Record<string, unknown>) !== m.hash) errors.push("hash mismatch — manifest was altered or is corrupt");

  if (opts.verifySignature) {
    if (!m.signature) errors.push("signature required but missing");
    else if (!opts.verifySignature(m.hash, m.signature)) errors.push("signature invalid — not the operator's manifest");
  }

  const allowed = new Set(opts.allowedAssets);
  if (!allowed.has(m.asset.id)) errors.push(`header asset not whitelisted: ${m.asset.id}`);
  if (m.asset.id === TOKEN_TAIL_TBD && !opts.allowPlaceholderAsset) errors.push(`asset is the placeholder ${TOKEN_TAIL_TBD} — set the real TAIL before sending`);
  for (const r of m.recipients) {
    if (r.assetId !== m.asset.id) errors.push(`recipient ${r.wallet} asset ${r.assetId} != header asset ${m.asset.id}`);
    if (!allowed.has(r.assetId)) errors.push(`asset not whitelisted: ${r.assetId} (recipient ${r.wallet})`);
  }

  for (const r of m.recipients) if (!WALLET_RE.test(r.wallet)) errors.push(`invalid payout wallet: ${JSON.stringify(r.wallet)}`);

  const seen = new Set<string>();
  let total = Z;
  for (const r of m.recipients) {
    const key = `${r.assetId} ${r.wallet}`;
    if (seen.has(key)) errors.push(`duplicate recipient: ${r.assetId}/${r.wallet}`);
    seen.add(key);
    let amt: bigint;
    try {
      amt = BigInt(r.amountUnits);
    } catch (_e) {
      void _e;
      errors.push(`bad amount for ${r.wallet}: ${r.amountUnits}`);
      continue;
    }
    if (amt <= Z) errors.push(`non-positive amount for ${r.wallet}: ${r.amountUnits}`);
    total += amt;
  }
  if (total.toString() !== m.totalUnits) errors.push(`total mismatch: recipients sum ${total} != declared ${m.totalUnits}`);
  if (m.recipientCount !== m.recipients.length) errors.push("recipientCount mismatch");

  if (m.kind === "reward" && opts.fundingCapUnits == null) errors.push("funding cap required for a reward manifest");
  if (opts.fundingCapUnits != null && total > opts.fundingCapUnits) errors.push(`payouts (${total}) exceed the funding cap (${opts.fundingCapUnits}) — would be insolvent`);

  if (m.recipients.length === 0) warnings.push("manifest has no recipients");
  const soft = BigInt(opts.maxRecipientShareBps ?? 2500);
  const hard = BigInt(opts.hardRecipientShareBps ?? 9000);
  if (total > Z && m.recipients.length > 1) { // a lone payee is trivially 100% — concentration rails only bite with 2+
    for (const r of m.recipients) {
      let amt: bigint;
      try { amt = BigInt(r.amountUnits); } catch { continue; } // bad amounts already errored above; don't throw here
      const bps = (amt * BigInt(10000)) / total;
      if (bps > hard) errors.push(`recipient ${r.wallet} is ${Number(bps) / 100}% of the epoch (> ${Number(hard) / 100}% hard cap)`);
      else if (bps > soft) warnings.push(`recipient ${r.wallet} is ${Number(bps) / 100}% of the epoch (> ${Number(soft) / 100}% — review)`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── Idempotency ledger (amount-aware) ───────────────────────────────────────────
export type Ledger = Map<string, string>;

export function paymentKey(m: PayoutManifest, r: ManifestRecipient): string {
  // collectionId prefix scopes the ledger per collection so two collections sharing an epoch id can't collide.
  // NOTE: this CHANGED the key format (added a leading element). No idempotency ledger is persisted yet and
  // provenance is still "shadow", so nothing to migrate today — but if a v1 ledger is ever persisted BEFORE
  // this line ships, it must be migrated (or key-versioned) or paid recipients would read as unpaid = double-pay.
  return JSON.stringify([m.collectionId ?? "", m.epochId, m.kind, r.assetId, r.wallet]);
}

export interface PendingResult {
  pending: ManifestRecipient[];
  conflicts: { recipient: ManifestRecipient; paidAmount: string; newAmount: string }[];
}

export function pendingRecipients(m: PayoutManifest, ledger: ReadonlyMap<string, string>): PendingResult {
  const pending: ManifestRecipient[] = [];
  const conflicts: PendingResult["conflicts"] = [];
  for (const r of m.recipients) {
    const paid = ledger.get(paymentKey(m, r));
    if (paid === undefined) pending.push(r);
    else if (paid !== r.amountUnits) conflicts.push({ recipient: r, paidAmount: paid, newAmount: r.amountUnits });
  }
  return { pending, conflicts };
}

export function markExecuted(m: PayoutManifest, ledger: Ledger, sent: ManifestRecipient[]): Ledger {
  for (const r of sent) ledger.set(paymentKey(m, r), r.amountUnits);
  return ledger;
}
