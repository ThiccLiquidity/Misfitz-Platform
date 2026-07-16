# $CHIPS payout bot — operator runbook

The bot is a **local CLI you run on your own machine**. It reads the epoch's settlement manifest from the site,
shows you exactly what would move/pay, and (when you say so) pays out the CATs through your **Sage** wallet. It
holds **no keys** (Sage signs), never executes a market trade (you do the one swap by hand), and a write-ahead
ledger makes a crash unable to double-pay.

## Files (all `src/lib/rewards/`)
- `bot.ts` — keyless orchestrator: verify → crash-recovery → ledger diff → caps → confirm → sequential send.
- `botLedger.ts` — atomic, write-ahead idempotency ledger on disk.
- `botSage.ts` — Sage wallet adapter (**TODO-CONFIRM the exact Sage RPC method names before your first LIVE send**).
- `botGate.ts` — terminal confirm (you must type `SEND`).
- `botConfig.ts` — config loader. `botCli.ts` — the CLI. Template: `bot-config.example.json`.

## One-time setup
1. `cp bot-config.example.json bot-config.json` and fill it in (keep it out of git — already `.gitignore`d):
   - `siteUrl` = your deployed site.
   - `REWARDS_OPS_SECRET` — set it as an **env var** (preferred) so it isn't on disk.
   - `sage.rpcUrl` — your local Sage wallet RPC endpoint (+ `apiKey` if Sage needs one).
   - `fundingCapUnits` — a hard per-run total cap in base units (the bot refuses to send more). Start from what a
     real shadow epoch showed × ~1.25.
   - `allowedAssets` — keep the `$CHIA` CAT id; add the **$CHIPS tail id once minted**. Never add the placeholder.
2. Make sure your fresh **distribution wallet** is loaded in Sage and funded per-epoch from the manifest's move total.

## Monthly flow
1. **Close the epoch** (operator, on the dashboard / `POST /api/rewards/close`).
2. **Preview** — safe, sends nothing, no wallet needed:
   ```
   REWARDS_OPS_SECRET=... npm run bot -- preview --epoch 2026-06
   ```
   It prints: how much XCH to move & swap (broken out by purpose), the $CHIPS drip table, and the per-wallet
   $CHIA-owed table. Sanity-check the totals against Dexie.
3. **Do the swap by hand:** move the manifest's `move` XCH to your distribution wallet, swap the reward slice
   XCH→$CHIA yourself, and note the **actual $CHIA received**.
4. **Finalize the reward manifest** with that received amount → a signed/finalized `reward` PayoutManifest
   (`finalizeRewardManifest`, saved to a file). *(This finalize step is the next thing to wire as a small
   endpoint/tool; until then the reward leg is built manually from the doc.)*
5. **Pay $CHIPS drip** (once $CHIPS is minted and its tail is in `allowedAssets`):
   ```
   REWARDS_OPS_SECRET=... npm run bot -- send --epoch 2026-06 --kind drip
   ```
   Add `--dry` to see the exact send list without broadcasting. On a real run you type `SEND` to confirm; the bot
   pays sequentially, writes each payment ahead to the ledger, waits for confirmation, then posts receipts back so
   the dashboard marks the epoch **paid**.
6. **Pay $CHIA reward** from the finalized file: `npm run bot -- send --file reward-2026-06.json` (add `--dry` first).

## Safety properties
- **Dry-run first, always.** `preview` and `--dry` never touch the wallet.
- **Hash + guards on every run:** asset whitelist (placeholder tail is hard-blocked), per-recipient concentration
  caps, funding cap, no duplicate recipients. v1 is **hash-only** (no operator signature yet — flip
  `requireSignature` true once the server signs manifests).
- **Crash can't double-pay:** every payment is written to the ledger *before* it's broadcast; on restart the bot
  reconciles orphaned "intended" payments via a Sage memo lookup, or **halts** for you (never auto-resends).
- **Reward manifests must be chain-verified** before the bot will send them (extra royalty check) — plumb the
  RoyaltyChainProvider before flipping `REWARDS_LAUNCH`.

## Still owner-blocked (see QUESTIONS.md)
Fresh distribution wallet fingerprint + Sage RPC details; the $CHIPS tail id (mint it); the funding caps; and the
on-chain royalty gate + manifest signing before real rewards go live. Until then: `preview` works today on real
shadow data; live `send` is correctly refused by the guards.
