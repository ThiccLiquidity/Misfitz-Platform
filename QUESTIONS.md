# QUESTIONS — decisions only YOU (owner) can make

These are pinned because they need a money / product-direction / wallet-keys decision, not a technical
judgment call. Each has a **recommended default** so you can just say "yes, defaults" and I'll proceed. Nothing
below is blocking the shadow-mode build — it's all about turning on real payouts.

Last updated: 2026-07-14 (overnight session).

---

## TASK 1 — Token & Airdrop ($SNACKZ) payout pipeline

### A. Fresh distribution wallet (needed before the bot can run)
1. **Create a brand-new wallet** dedicated to distributions (not your royalty/personal wallet). I need its
   **fingerprint** and confirmation of which wallet software (Sage / GUI / chia CLI) so the bot's RPC config
   matches. — *Recommended: a fresh Sage wallet or a dedicated chia CLI fingerprint, kept only for payouts.*
2. **Wallet RPC access for the local bot:** the RPC host/port and the path to the cert/key the bot will use
   (`~/.chia/mainnet/config/ssl/...`). The bot runs on YOUR machine and talks to YOUR node/wallet — I never
   see keys. — *Recommended: run the bot on the same box as the wallet, default `https://localhost:9256`.*
3. **Funding:** the reward pot ($CHIA buy) + burn pot are XCH you move to this wallet per-epoch from the
   manifest's `moveToHotWalletMojos`. The drip pays out **$SNACKZ from treasury** — confirm the treasury wallet
   that holds the $SNACKZ supply and whether it's the same distribution wallet or separate. — *Recommended:
   separate treasury wallet holds $SNACKZ; distribution wallet is funded per-epoch only with what the manifest
   says, so a bug can never touch more than one epoch's pot.*

### B. Swap step (XCH → $CHIA for trade rewards, XCH → $SNACKZ for buy&burn)
4. **Manual vs. automated swap.** *Recommended: you do the one swap by hand each epoch and enter the actual
   $CHIA received; the payout split absorbs the slippage automatically.* This is more robust than automating a
   DEX swap in the bot and keeps "the app never moves funds" true. Confirm you're OK doing one manual swap per
   epoch. (If you'd rather automate later, we can, behind the same manifest.)
5. **Buy&burn destination:** where do burned $SNACKZ go — a burn address you specify, or hold-to-burn? I need
   the burn address (or "no on-chain burn yet, just track it"). — *Recommended: send to a documented burn
   address; until you give one, the manifest just reports the burn amount and sends nothing.*

### C. Safety caps & whitelist (bot guardrails)
6. **Hard per-payout and per-epoch caps** (mojos / $SNACKZ units) above which the bot refuses to send without an
   extra manual override. — *Recommended: per-recipient cap = 3× the largest legitimate epoch payout you've
   seen in shadow; per-epoch cap = 1.25× the epoch's manifest total. I'll set conservative numbers from the
   first real shadow epoch and you confirm.*
7. **Asset-ID whitelist:** confirm the $CHIA CAT asset id (currently
   `69326954fe16117cd6250e929748b2a1ab916347598bc8180749279cfae21ddb`) and provide the **$SNACKZ tail id once
   minted**. The bot refuses any asset not on the whitelist and hard-blocks the `TOKEN_TAIL_TBD` placeholder.
   — *Recommended: keep the $CHIA id above; send me the $SNACKZ tail the moment it's minted.*

### D. Product decisions
8. **Epoch cadence & close trigger.** You said operator-triggered (not a cron date). Confirm: epochs are
   **calendar-monthly for accounting** but you press "Close" manually when you're ready to pay. — *Recommended:
   monthly boundaries, manual close, a few days' grace so late sales reach finality before you close.*
9. **Artist cut (1%) destination** — confirm it just stays as XCH in the royalty wallet (no action needed), or
   you want it swept somewhere. — *Recommended: leave it as XCH in the royalty wallet; the manifest only
   reports it.*
10. **Drip eligibility snapshot.** The holder snapshot for the drip is currently an *approximate* read from the
    warmed roster (as fresh as the last scan). Do you want a **deterministic block-height snapshot** before
    real drips go out? — *Recommended: yes, add a block-height snapshot before the first real drip; fine to
    keep the approximate one for shadow.*
11. **Minimum payout dust floor** — skip paying wallets owed less than X (avoids spending more in fees than the
    payout is worth). — *Recommended: skip reward payouts under ~0.001 XCH-equivalent and roll the dust to
    burn; skip drips under 1 whole $SNACKZ unit.*

### E. Launch gate
12. **When do we flip `REWARDS_LAUNCH` on?** Everything runs in shadow until then. — *Recommended: only after
    you've watched ≥1 full epoch compute on real live data, dry-run the bot against it, and manually verified
    the manifest totals against Dexie.*
13. **First real epoch** — which month is the first one that actually pays out (vs. shadow backfill)? —
    *Recommended: pick the first full month after $SNACKZ is minted and the bot dry-run looks right.*
14. **Legal/tax framing of rewards & drips** — is there any disclosure/withholding you want surfaced to
    recipients or kept in records? Not something I should decide. — *Recommended: keep a per-epoch immutable
    manifest + receipts as your audit trail; get a human to eyeball the tax treatment before first payout.*

---

## Notes
- Items A/B/C are what unblock the **local bot** (Task 1 step 5) — until then the bot ships as a dry-run-only
  CLI that reads a manifest and prints exactly what it *would* send.
- Everything else in Task 1 (tracking, close endpoint, manifest download, dashboard, receipts) is being built
  now in shadow mode and does not need any of the above to be inspected on real data.

---

## RESOLVED — decisions locked this session (2026-07 rename + genesis airdrop)
- **Token renamed $CHIPS → $SNACKZ** (the meme/drip coin). $CHIA reward asset unchanged. Config key is now the
  rename-proof `tokenAssetId` / `TOKEN_ASSET_ID`; display symbol is `$SNACKZ` everywhere.
- **Genesis airdrop = the one-time 100M bucket** (`MISFITZ_TOKEN.airdropUnits`), NOT the recurring drip.
- **Split = rarity-weighted per NFT** (same curve as the drip — rarer holdings get more).
- **Snapshot = fresh full-scan, FROZEN at launch** (not a block-height snapshot).
- **Timing = fire only AFTER Misfitz is fully distributed** (the mint sells out).
- **Project/mint wallet(s) are EXCLUDED** from the airdrop roster (never airdrop to undistributed inventory).
- Built + tested: `src/lib/rewards/airdrop.ts` (`buildLaunchAirdrop` + `finalizeAirdropManifest`), pure, solvent.

### Still needed from the owner before the genesis airdrop can run
1. **$SNACKZ tail id** (mint the token) → into `tokenAssetId`.
2. **Project/mint wallet address(es)** to exclude from the snapshot.
3. **Distribution wallet fingerprint** (the Sage wallet that holds + sends the 100M) — the bot's wallet-pin.
4. **Confirmation the collection is fully distributed** (the trigger to snapshot + send).

### Follow-up bot hardening (recommended, not blocking — deferred)
- **Epoch-manifest sentinel:** make "a one-time airdrop pays out once" structurally true against re-cuts.
  On first send, write a ledger sentinel `[collectionId, epochId, kind, "__manifest__"] -> manifestHash`;
  the bot then conflict-halts any later manifest for an already-started epoch whose hash differs. Until this
  ships, the runbook mitigation (freeze once + `--expect-hash`, never re-cut) covers it operationally.
