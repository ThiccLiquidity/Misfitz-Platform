// MisFitz Rewards — bot dependency INTERFACES (operator-implemented). The orchestrator (bot.ts) is keyless and
// pure; the operator injects these on their own machine. WE ship NO implementation of WalletRpc/LedgerStore and
// hold NO keys. See BOT-CONTRACT.md.

import { type Ledger } from "./manifestGuard";

export interface WalletRpc {
  // Send `amountUnits` of CAT `assetId` to `toWallet`. `dedupeTag` is the ledger paymentKey — the impl SHOULD
  // attach it as a memo so a crash-recovery lookup can find an already-broadcast tx.
  sendCat(p: { assetId: string; toWallet: string; amountUnits: bigint; dedupeTag: string }): Promise<{ txId: string }>;
  waitConfirmed(txId: string, timeoutMs: number): Promise<boolean>;
  // Optional crash-recovery: has a payment with this dedupeTag already been broadcast? Returns its txId or null.
  // If absent, the bot HALTS on any orphaned "intended" (never auto-resends) and the operator reconciles.
  lookupTx?(dedupeTag: string): Promise<string | null>;
}

export interface LedgerStore {
  load(): Promise<Ledger>;                                        // Map<paymentKey, amountUnits>
  markIntended(key: string, amountUnits: string): Promise<void>;  // WRITE-AHEAD: must be durable before the send
  markDone(key: string, amountUnits: string, txId: string): Promise<void>; // only after the send confirmed
  intended(): Promise<{ key: string; amountUnits: string }[]>;    // intended-but-not-done (crash residue)
}

export type SignatureVerifier = (hashHex: string, signature: string) => boolean;
export interface ConfirmGate { confirm(summary: string): Promise<boolean> } // human answers; false = abort, send nothing

export interface BotDeps { wallet: WalletRpc; store: LedgerStore; verifySig: SignatureVerifier; gate: ConfirmGate }

export interface BotOpts {
  allowedAssets: string[];
  fundingCapUnits: bigint;   // MANDATORY every run (stricter than the guard)
  maxSends?: number;         // absolute per-run recipient cap (default 500)
  confirmTimeoutMs?: number; // waitConfirmed budget per send (default 120s)
  allowUnsigned?: boolean;   // DELIBERATE hash-only mode (v1): skip the operator-SIGNATURE gate but keep the hash
                             // + all other guards. Must be set explicitly — a normal run still requires a signer.
}
