# MisFitz Rewards — Launch Runbook

Plain-English handoff: what's built, what's yours to do, and the exact order to go live.
Companion to `MISFITZ-REWARDS.md` (the locked design/decision log) and `BOT-CONTRACT.md` (the bot spec).

> **Nothing here moves money on its own.** Traitfolio computes and publishes signed instructions; YOU (or your
> bot, with your keys) execute every buy, send, and burn. Everything below is OFF until you turn it on, and the
> public dashboard stays hidden until legal clears it.

---

## 1. What's already built (and what each piece is for)

| Piece | File(s) | What it does | Unblocks |
|---|---|---|---|
| Reward engine | `engine.ts` | Splits each sale's 10% royalty into artist/buyer/seller/bonus/burn. Solvent by math. | The whole payout calc |
| Sale detection | `detect.ts`, `detectLive.ts` | Finds MisFitz sales on Dexie, tags the deal color, attributes buyer/seller. | Knowing who earned what |
| Frozen deal tag | `tagStore.ts` | Locks a sale's green/blue/yellow color at first detection so it can't change later. | Fair bonuses |
| Holder drip | `allocator.ts`, `allocatorLive.ts` | Splits the monthly $TOKEN drip across holders, rarity-weighted. | The airdrop/drip |
| Token supply | `token.ts` | 1B supply, buckets (10/80/7/3), 5%/mo geometric drip, burn accounting. | Token math |
| Unattributed → burn | `settle.ts` | Rewards with no verifiable wallet go to the burn, not a stranger. | Clean payouts |
| Operator plan | `operator.ts` | "Send X XCH to the hot wallet → this to $CHIA, this to burn, keep the artist cut." | Your monthly action |
| On-chain royalty gate | `chainProvider.ts`, `chainVerify.ts` | Confirms the royalty was really paid on-chain; takes true buyer/seller/price from the blockchain. | Real (not shadow) payouts |
| Payout manifest + guard | `manifest.ts`, `manifestGuard.ts` | Signed, tamper-proof instruction file; a strict pre-send safety check + a no-double-pay ledger. | Safe sends |
| Keyless bot | `bot.ts`, `botDeps.ts`, `BOT-CONTRACT.md` | The safe send loop your local bot runs (verify → confirm → send → record). | Actual sends |
| Real pipeline | `pipeline.ts`, `finalize.ts` | One entry point: detect → verify → settle → plan → (after your buy) sign the manifest. | The monthly flow |
| Live dashboard | `snapshotJob.ts`, `/api/rewards/*`, `RewardsDashboard.tsx` | Shows the running numbers on the MisFitz page. Flag-gated OFF. | Public visibility |

Status: **~120 unit tests green, typechecks clean, fable-reviewed.** All of the above needs no keys/node/legal.

---

## 2. See it working today (private, no setup, no money)

In PowerShell, from the project folder:

```
npx tsx src/lib/rewards/shadowEpoch.ts          # last 30 days of MisFitz sales, full picture
npx tsx src/lib/rewards/dripRun.ts 1            # who gets what in $TOKEN this month
```

These print real numbers in your terminal. Nothing is public, nothing moves.

---

## 3. Turn on the dashboard in a TEST deploy (still no money)

In Vercel → your project → Settings → Environment Variables, add:

```
REWARDS_SHADOW = 1
CRON_SECRET    = <any long random string>
REWARDS_LAUNCH = 2026-07        (optional; sets the drip month)
REWARDS_OPS_SECRET  = <long random string>   (optional; unlocks the operator-only panel)
REWARDS_PROFILE_OPTOUT = <comma-separated wallets/DIDs>  (optional; hide these from leaderboards)
```

Notes on the two new optional vars:
- `REWARDS_OPS_SECRET` gates the operator actions ("send X to the hot wallet"). Those numbers are NOT in the
  public payload. To see them, open the collection page with `?ops=<REWARDS_OPS_SECRET>`. Anyone without the
  secret just sees the public dashboard + leaderboards. Leave unset to disable the operator panel entirely.
- `REWARDS_PROFILE_OPTOUT` removes a wallet's name/pfp from the public leaderboards (it still shows a truncated
  address). List BOTH the `xch1…` and `did:chia…` forms if a person uses both. Takes effect on the next cron
  recompute (identities are baked into the snapshot).

Redeploy, then trigger the compute once:

```
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-host>/api/rewards/cron
```

Open the MisFitz collection page → the "SHADOW PREVIEW" panel appears. (Needs the nightly `/api/warm` to have
run once, so the holder list exists.) **Keep `REWARDS_SHADOW` OFF in production until legal clears it.**

---

## 4. The road to real payouts (in order)

### Phase A — Legal (start now; it's the long pole)
- [ ] Engage a crypto/securities lawyer. Rewarding trades + a deflationary token + buy-&-burn carry
      securities/AML/tax exposure. **This gates launch and gates showing the public dashboard.**

### Phase B — Token + wallets (yours)
- [ ] Confirm the MisFitz royalty is exactly **10%**; note the creator wallet address.
- [ ] Decide the **$TOKEN name**, then mint the single-issuance **TAIL** (1,000,000,000 supply).
      Put the real tail id in `token.ts` / `manifest.ts` (replaces `TOKEN_TAIL_TBD`).
- [ ] Choose an **unspendable burn address**; set `burnAddress` in `token.ts`.
- [ ] Generate an **operator signing keypair**; note the public key (the bot verifies signatures with it).
- [ ] Set up a dedicated **ops/hot wallet**.

### Phase C — Plug in your node + wallet (a developer, against the built contracts)
- [ ] Implement `RoyaltyChainProvider` (`chainProvider.ts`) against your Chia full-node RPC or an indexer.
- [ ] Implement `WalletRpc` + `LedgerStore` (`botDeps.ts`, per `BOT-CONTRACT.md`) on your machine.
- [ ] Run: `prepareRewardEpoch` → your $CHIA buy → `finalizeRewardManifest` (sign) → `runBotPayout`.
      (For the drip: holder snapshot → `finalizeDripManifest` → `runBotPayout`.)

### Phase D — Liquidity + first distribution (yours)
- [ ] Seed TibetSwap LP with the 7% LP bucket.
- [ ] Do the initial **10% airdrop** to current holders.

### Phase E — Prove it, then go live
- [ ] **Dry-run / testnet** first (the bot shows exactly what it would send; you approve).
- [ ] One real epoch with **tiny amounts** to prove the full loop.
- [ ] Run **1–2 shadow epochs** with published points and **zero payouts** so holders see it working.
- [ ] Legal ✅ → flip the public dashboard on → first real monthly payout.

---

## 5. Small code cleanups still open (I can do these anytime)
- [ ] Install the `server-only` npm package (a build-time tripwire; currently a runtime guard stands in).
- [ ] Normalize DID-vs-`xch1` keys in the wallet lookup (a holder listed under one form who pastes the other
      currently gets "not found").
- [ ] Still-unbuilt design items: bundle/auction sales, and pinning the drip snapshot to a specific block.

---

## 6. The monthly routine (once live)
1. Server publishes the signed reward + drip manifests (reward = chain-verified).
2. Read the dashboard's "Send X XCH to the hot wallet" line; do the $CHIA and $TOKEN buys.
3. Run the bot for the reward manifest, then the drip manifest; send the burn $TOKEN to the burn address.
4. Approve each dry-run summary; keep the receipts.

**Never:** send without a signature, pay a reward manifest that isn't chain-verified, or let the bot hold any
Traitfolio key. The guard + bot enforce this, but know it.
