// MisFitz Rewards — keyless bot ORCHESTRATOR (pure; deps injected). This is the operator bot's core: verify the
// signed manifest, refuse on any ledger conflict, dry-run, get operator confirmation, then send SEQUENTIALLY
// with a write-ahead ledger so a crash never double-pays. It holds no keys and makes no network calls except
// through injected deps. Every halt is fail-closed. See BOT-CONTRACT.md.

import { verifyManifest, paymentKey, pendingRecipients, type Ledger } from "./manifestGuard";
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

  // The signature gate is only enforced when a verifier is supplied — so the bot MUST have one (no JS caller can
  // wire `verifySig: undefined` and silently disable it).
  if (typeof deps.verifySig !== "function") return halt("no signature verifier configured — refusing to send");

  // 1) Verify — signature is MANDATORY here (the bot always supplies the verifier; no opt-out). Reward manifests
  //    must be chain-verified (Design 1's gate) before a single payment goes out.
  const vr = verifyManifest(m, { allowedAssets: opts.allowedAssets, fundingCapUnits: opts.fundingCapUnits, verifySignature: deps.verifySig });
  if (!vr.ok) return halt("verify failed: " + vr.errors.join("; "));
  if (m.kind === "reward" && m.provenance !== "chain-verified") return halt("reward manifest is not chain-verified — run the on-chain royalty gate first");

  // 2) Crash-recovery sweep: an "intended" with no "done" means we may have sent (or not) before a crash. Never
  //    auto-resend — resolve via the wallet's dedupe lookup, else HALT for the operator.
  const intended = await deps.store.intended();
  const ledger: Ledger = await deps.store.load();
  for (const it of intended) {
    if (ledger.get(it.key) === it.amountUnits) continue; // already done
    const tx = deps.wallet.lookupTx ? await deps.wallet.lookupTx(it.key).catch(() => null) : null;
    if (tx) { await deps.store.markDone(it.key, it.amountUnits, tx); ledger.set(it.key, it.amountUnits); }
    else return halt(`unresolved intended payment: ${it.key} — reconcile before re-running`);
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
