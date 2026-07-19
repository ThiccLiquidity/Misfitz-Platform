# MisFitz Rewards — Local Bot Contract

The Traitfolio server computes rewards and publishes a **hash-signed manifest**. Your **local bot** (this machine,
your keys) is the only thing that moves funds. Traitfolio never holds keys and never sends. This is the contract
your bot implements. The safe orchestration is already written and tested (`src/lib/rewards/bot.ts`); you supply
four dependencies and press "yes".

## Non-negotiables (the orchestrator enforces these; do not work around them)
1. **A valid operator SIGNATURE is required** on every manifest before any send. The hash proves integrity; the
   signature proves it's really your manifest. (`runBotPayout` always supplies the verifier — no opt-out.)
2. **Reward manifests must be `provenance: "chain-verified"`** — i.e. the on-chain royalty gate ran. A `shadow`
   reward manifest is refused.
3. **Write-ahead ledger**: persist "intended" durably BEFORE the send, "done" only AFTER it confirms. This is the
   entire crash-safety story — a crash leaves at most one ambiguous payment, never a double-pay.
4. **Sends are sequential**, one in flight. **Any failed/unconfirmed send halts the whole run.** Ledger conflicts
   (a changed amount for an already-paid recipient) halt — never auto-top-up.
5. The bot makes **no network calls except through the injected deps** and holds **none of Traitfolio's keys**.

## What you implement (`src/lib/rewards/botDeps.ts`)
- **`WalletRpc`** — `sendCat({assetId, toWallet, amountUnits, dedupeTag}) → {txId}` and `waitConfirmed(txId, ms)`.
  Attach `dedupeTag` (the ledger key) as a memo. Optionally `lookupTx(dedupeTag) → txId|null` for crash recovery
  (without it, any orphaned "intended" halts for you to reconcile by hand).
- **`LedgerStore`** — durable `load()/markIntended()/markDone()/intended()` on your disk (SQLite or a JSON file
  with fsync). `markIntended` and `markDone` must be committed before they resolve.
- **`SignatureVerifier`** — `(hashHex, signature) → boolean` against your operator public key.
- **`ConfirmGate`** — `confirm(summary) → boolean`. Even a terminal y/N prompt. `false` sends nothing.

## The flow (already implemented — `runBotPayout(manifest, deps, opts)`)
verify (sig mandatory + provenance) → crash-recovery sweep of `intended` → refuse on any ledger `conflicts` →
compute `pending` (skips already-paid) → cap check → dry-run summary → your `confirm()` → **sequential** loop:
`markIntended` → `sendCat` → `waitConfirmed` → `markDone` → receipt. Returns `{status, sent[], skippedAlreadyPaid}`;
`status` is `completed | aborted | halted`. Re-running after any halt is safe and idempotent.

## Wallet isolation (the bot may only ever touch the DESIGNATED distribution wallet)
Sage's RPC spends from **whatever key is logged in** — `send_cat` does not select a wallet. Two layers, both
mandatory before the first live send:

1. **Physical isolation (operational — code cannot substitute for this).** The distribution wallet lives on its
   own Sage profile, ideally its own Sage instance / OS user / machine, holding **only** one epoch's funding.
   Then even a total bot compromise can only reach that wallet's balance. Your personal/royalty keys should
   never be loadable by the Sage instance the bot talks to.
2. **Fingerprint pin (enforced in code, fail-closed).** `bot-config.json` must set `sage.fingerprint` to the
   distribution wallet's key fingerprint. A live send REFUSES if it is unset; the orchestrator halts before the
   first send — and the Sage adapter re-checks before **every** send — unless Sage's active fingerprint equals
   the pin. Probe error, unknown fingerprint, or mismatch all HALT with nothing sent. Never assume; never
   auto-switch keys (`login` is deliberately not called).

Plus blast-radius bounds (already mandatory): fund the wallet **per-epoch only** with the manifest's totals, and
set `fundingCapUnits` ≈ that epoch's total — a bug can never touch more than one epoch's pot.

**Operator must confirm once against the installed Sage version (TODO-CONFIRM in `botSage.ts`):** the exact RPC
method that reports the active key's fingerprint (guessed as `get_key`), and that `send_cat` indeed has no
per-call key selector. A wrong guess fails closed (halt), but the pin only *protects* once the probe is real.

## The on-chain royalty gate (`src/lib/rewards/chainVerify.ts`, before a REAL reward manifest)
Implement `RoyaltyChainProvider` (`chainProvider.ts`) against your full node RPC or an indexer: for each sale it
returns the settlement spend (payments, buyer/seller, price, coin/spend/block, depth). `verifySales(sales,
provider, cfg)` then confirms the royalty coin actually paid your creator wallet (≥ `minRoyaltyBps` of the chain
price, ≥ `minBlockDepth` confirmations, single-NFT, XCH-only) and returns `{verified, retry, rejected}`. Only
`verified` sales (with their ACTUAL on-chain royalty/attribution) build the reward manifest as `chain-verified`;
`retry` roll to next run; `rejected` are excluded from every pot (a missing royalty is an evasion signal to audit,
not a rewards event).

## Run book (monthly)
0. **Wallet check (every run):** open Sage on the DISTRIBUTION profile only (log out / close any other profile —
   the pin will halt on them anyway, but don't rely on it alone); verify the fingerprint shown matches
   `sage.fingerprint` in the config. First live run ever: do a tiny canary first — a 1-recipient manifest for a
   minimal amount to a wallet you control, verify it on-chain, then proceed.
1. Server publishes the month's reward + drip manifests (signed). Reward manifest is `chain-verified`.
2. Read the "Send X XCH to the hot wallet" figure from the dashboard/operator plan; do the $CHIA and $TOKEN buys
   yourself; send the artist cut nowhere (it stays). Fund the distribution wallet with THIS epoch's totals only.
3. Run the bot for the reward manifest, then the drip manifest, then send the burn $TOKEN to the burn address.
4. Confirm each dry-run summary. Keep the receipts log.

## Never
Send without a signature · pay a non-chain-verified reward manifest · `markDone` before the RPC confirmed ·
auto-resolve a conflict · run sends in parallel · continue past a failed send · put any Traitfolio key in the bot ·
send from an unpinned wallet (or auto-`login` to "fix" a mismatch) · keep more than one epoch's funds in the
distribution wallet.
