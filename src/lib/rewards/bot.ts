// MisFitz Rewards — keyless bot ORCHESTRATOR (pure; deps injected). This is the operator bot's core: verify the
// signed manifest, refuse on any ledger conflict, dry-run, get operator confirmation, then send SEQUENTIALLY
// with a write-ahead ledger so a crash never double-pays. It holds no keys and makes no network calls except
// through injected deps. Every halt is fail-closed. See BOT-CONTRACT.md.

import { verifyManifest, paymentKey, pendingRecipients, manifestSentinelKey, type Ledger } from "./manifestGuard";
import { type PayoutManifest, type ManifestRecipient } from "./manifest";
import { type BotDeps, type BotOpts } from "./botDeps";

export interface PayoutReceipt { wallet: string; assetId: string; amountUnits: string; txId: string }
export interface BotRunResult {
  status: "completed" | "aborted" | "halted";
  haltReason?: string;
  sent: PayoutReceipt[];         // what DID go out before any halt (never lost)
  skippedAlreadyPaid: number;
}

// Pure dry-run summary shown to the operator before anything is sent.
export function summarizePayout(m: PayoutManifest, pending: ManifestRecipient[], alreadyPaid: number, warnings: string[]): string {
  const total = pending.reduce((s, r) => s + BigInt(r.amountUnits), BigInt(0));
  const L = [
    `Manifest [${m.kind}] epoch ${m.epochId} · asset ${m.asset.symbol} · provenance ${m.provenance}`,
    `hash ${m.hash}`,
    `WILL SEND ${pending.length} payment(s) · already paid ${alreadyPaid} · total ${total} base units`,
  ];
  for (const r of pending.slice(0, 5)) L.push(`  → ${r.wallet}  ${r.amountUnits}`);
  if (pending.length > 5) L.push(`  … +${pending.length - 5} more`);
  if (warnings.length) L.push(`warnings: ${warnings.join("; ")}`);
  return L.join("\n");
}

export async function runBotPayout(m: PayoutManifest, deps: BotDeps, opts: BotOpts): Promise<BotRunResult> {
  const sent: PayoutReceipt[] = [];
  const halt = (haltReason: string): BotRunResult => ({ status: "halted", haltReason, sent, skippedAlreadyPaid: 0 });

  // The signature gate is enforced unless the operator DELIBERATELY set allowUnsigned (hash-only v1). A normal
  // run must supply a verifier — no JS caller can silently wire `verifySig: undefined` to disable it.
  if (!opts.allowUnsigned && typeof deps.verifySig !== "function") return halt("no signature verifier configured — refusing to send");

  // 1) Verify — hash + guards always; the operator SIGNATURE too unless allowUnsigned. Reward manifests must be
  //    chain-verified (Design 1's gate) before a single payment goes out.
  const vr = verifyManifest(m, { allowedAssets: opts.allowedAssets, kind: opts.expectedKind, fundingCapUnits: opts.fundingCapUnits, verifySignature: opts.allowUnsigned ? undefined : deps.verifySig });
  if (!vr.ok) return halt("verify failed: " + vr.errors.join("; "));
  if (m.kind === "reward" && m.provenance !== "chain-verified") return halt("reward manifest is not chain-verified — run the on-chain royalty gate first");
  // Bind kind->asset: a tampered "drip" manifest must not be able to pay out $CHIA (or vice-versa).
  if (opts.expectedAssetId && m.asset.id !== opts.expectedAssetId) return halt(`manifest asset ${m.asset.id} is not the expected asset for a ${m.kind} payout — refusing`);
  // Every recipient's paymentKey is scoped by collectionId; a missing one risks a cross-collection ledger
  // collision (double-pay or a silent skip). Refuse rather than pay on an ambiguous key.
  if (!m.collectionId) return halt("manifest has no collectionId — refusing (payment-key collision risk)");

  // 2) Crash-recovery sweep: an "intended" with no "done" means we may have sent (or not) before a crash. Never
  //    auto-resend — resolve via the wallet's dedupe lookup, else HALT for the operator.
  const intended = await deps.store.intended();
  const ledger: Ledger = await deps.store.load();
  for (const it of intended) {
    if (ledger.get(it.key) === it.amountUnits) continue; // already done
    const tx = deps.wallet.lookupTx ? await deps.wallet.lookupTx(it.key).catch(() => null) : null;
    if (tx) {
      // A found tx is NOT proof of payment — Sage keeps failed/evicted/pending records too. Hold it to the same
      // bar as a fresh send: confirm on-chain or HALT for the operator (never mark a dead tx as paid).
      const confirmed = await deps.wallet.waitConfirmed(tx, opts.confirmTimeoutMs ?? 120_000);
      if (!confirmed) return halt(`recovered tx ${tx} for ${it.key} exists but is NOT confirmed on-chain — reconcile before re-running`);
      await deps.store.markDone(it.key, it.amountUnits, tx); ledger.set(it.key, it.amountUnits);
    } else return halt(`unresolved intended payment: ${it.key} — reconcile before re-running`);
  }

  // 2.5) EPOCH SENTINEL — refuse a DIFFERENT manifest for an epoch that already started sending. Prevents a
  // re-cut manifest (e.g. a re-frozen airdrop snapshot, or a changed monthly drip) from over-emitting in
  // aggregate across runs, since the per-recipient ledger alone can't see wallets that dropped out of a re-cut.
  const sentinelKey = manifestSentinelKey(m);
  const startedHash = ledger.get(sentinelKey);
  if (startedHash && startedHash !== m.hash) {
    return halt(`epoch ${m.epochId} already started with a different manifest (hash ${startedHash.slice(0, 12)}…) — refusing this one (${m.hash.slice(0, 12)}…). If ZERO payments were recorded for this epoch (check the ledger\u2019s done map), deleting the sentinel entry is safe; otherwise reconcile before continuing.`);
  }

  // 3) Ledger diff — a changed amount for an already-paid recipient is a conflict; NEVER auto top-up.
  const { pending, conflicts } = pendingRecipients(m, ledger);
  if (conflicts.length) return halt(`ledger conflict on ${conflicts.length} recipient(s) — a re-cut manifest needs manual reconciliation`);
  const skippedAlreadyPaid = m.recipients.length - pending.length;
  if (pending.length === 0) return { status: "completed", sent, skippedAlreadyPaid };

  // 4) Caps
  const maxSends = opts.maxSends ?? 500;
  if (pending.length > maxSends) return halt(`pending ${pending.length} exceeds maxSends ${maxSends}`);

  // 5) Dry-run + operator confirmation (declining sends nothing).
  const ok = await deps.gate.confirm(summarizePayout(m, pending, skippedAlreadyPaid, vr.warnings));
  if (!ok) return { status: "aborted", sent, skippedAlreadyPaid };

  // 5.5) WALLET PIN (fail-closed): prove the RPC is operating on the DESIGNATED distribution wallet before a
  // single coin moves. preflight() must throw on a fingerprint mismatch OR whenever the wallet's identity can't
  // be confirmed — any throw halts with nothing sent. It runs here (after confirm, not earlier) so the human
  // pause between summary and "yes" can't widen a pin-check→send gap; the Sage adapter also re-asserts the pin
  // inside every sendCat. Steps 1–5 are spend-free (recovery only READS tx status), so a wrong wallet before
  // this point can only cause a halt, never a send.
  if (opts.requireWalletPreflight && typeof deps.wallet.preflight !== "function") {
    return halt("wallet has no preflight() wallet-pin guard but requireWalletPreflight is set — refusing to send");
  }
  if (typeof deps.wallet.preflight === "function") {
    try { await deps.wallet.preflight(); }
    catch (e) { return halt(`wallet preflight failed: ${(e as Error)?.message ?? String(e)}`); }
  }

  // Pin the epoch to THIS manifest hash before the first send (write-ahead). A resume with the same manifest
  // passes the sentinel check above; any re-cut against a different snapshot halts there.
  if (!startedHash) {
    try { await deps.store.markDone(sentinelKey, m.hash, "epoch-sentinel"); ledger.set(sentinelKey, m.hash); }
    catch (e) { return halt(`could not persist the epoch sentinel: ${(e as Error)?.message ?? String(e)}`); }
  }

  // 6) Sequential send loop with write-ahead. Any throw/timeout halts immediately; sent + ledger are preserved.
  for (const r of pending) {
    const key = paymentKey(m, r);
    try {
      await deps.store.markIntended(key, r.amountUnits);
      const { txId } = await deps.wallet.sendCat({ assetId: r.assetId, toWallet: r.wallet, amountUnits: BigInt(r.amountUnits), dedupeTag: key });
      const confirmed = await deps.wallet.waitConfirmed(txId, opts.confirmTimeoutMs ?? 120_000);
      if (!confirmed) return halt(`send not confirmed for ${r.wallet} (tx ${txId})`);
      await deps.store.markDone(key, r.amountUnits, txId);
      sent.push({ wallet: r.wallet, assetId: r.assetId, amountUnits: r.amountUnits, txId });
    } catch (e) {
      return halt(`send failed for ${r.wallet}: ${(e as Error)?.message ?? String(e)}`);
    }
  }
  return { status: "completed", sent, skippedAlreadyPaid };
}
