# Token & Airdrop System — Audit (as of 2026-07-14)

Purpose: map what the $CHIPS reward + airdrop pipeline already has vs. what still has to be built, so the
end-to-end operator workflow (track → operator closes epoch → download one manifest → local bot pays out) can
be finished without the token existing yet. Nothing here moves funds or depends on $CHIPS being minted.

**Token status:** name finalized as **$CHIPS**, NOT yet minted. Everywhere the tail id is needed the code uses
the placeholder `TOKEN_TAIL_TBD` (`src/lib/rewards/manifest.ts`), and the manifest guard hard-blocks any send
against that placeholder — so the whole system is buildable and testable now and only the final "send drip"
step is gated on the mint.

---

## Verdict

Roughly **70% already exists** as isolated, unit-tested library code (the money math, allocator, manifest
tooling, settlement, shadow snapshot pipeline, operator plan, dashboard). The missing **~30% is glue**, not
math: there is no operator-triggered *close*, no single downloadable settlement manifest, no epoch
lifecycle/paid state, no receipts channel, and no runnable local bot. The build order the owner specified
(tracking → manifest → dashboard → bot) is correct and matches where the gaps are.

Everything here already runs in **shadow mode** today: `npx tsx src/lib/rewards/shadowEpoch.ts` computes a full
epoch on mock data end-to-end (engine → settle → operator plan → manifests) and prints it, moving nothing.

---

## What EXISTS (tested library code — do not rebuild)

Money core (pure, bigint mojos, solvency guaranteed by construction):
- `engine.ts` — `computeEpoch(sales, signals, start, end, cfg, payoutAt)` → `EpochResult` (per-wallet
  buyer/seller/bonus, artist slice, burn pot). **Already takes `payoutAt`**, so an operator-triggered close at
  an arbitrary time is a supported input, not a rewrite. `distributeChia()` shares the actual $CHIA received
  across payees proportionally with exact dust handling.
- `types.ts` — the domain types; buckets are the locked 10% royalty / 1% artist / 2.5% buyer / 2.5% seller /
  2.5% bonus / residual-burn split. Invariant: the five slices sum to the royalty exactly.
- `settle.ts` — `settleUnattributed()` routes rewards whose wallet couldn't be verified into the burn (never
  paid to an `unknown-*` placeholder); `assertSettlementSolvent()` refuses to publish an insolvent split.
- `operator.ts` — `operatorPlanFromSettlement()` = the "what do I move where" numbers: `moveToHotWalletMojos`
  (reward pot + burn pot), `forRewardMojos` (swap→$CHIA), `forBurnMojos` (swap→buy&burn), `keepArtistMojos`
  (1% stays as XCH). Invariant: move + keep === total royalty.
- `allocator.ts` — holder drip allocation (`weighHoldings` + `allocateDrip`); `token.ts` — `dripForMonth()`
  schedule.

Manifest tooling (pure, hash-verified, immutable):
- `manifest.ts` — `buildRewardManifest()`, `buildDripManifest()`, canonical `stableStringify` + `hashManifest`
  (sha256 over the sorted body), `signManifest()`, `formatManifest()` (human dry-run). Amounts are strings in
  base units so the hash is stable. `provenance` must be `"chain-verified"` before the bot will send a reward.
- `finalize.ts` — `finalizeRewardManifest(prepared, chiaReceived, sign)` and `finalizeDripManifest()`:
  assemble the signed, chain-verified manifests. Refuses to finalize while any sale is still awaiting finality.
- `manifestGuard.ts` — send-time guards (asset-id whitelist, `TOKEN_TAIL_TBD` block, signature required, caps).

Pipeline + shadow persistence (server, network, flag-gated):
- `pipeline.ts` (`prepareRewardEpoch`) + `detect.ts`/`detectLive.ts` — live Dexie sales → attributed,
  chain-verified epoch inputs.
- `snapshotJob.ts` — `computeRewardsSnapshot()` runs the whole monthly pipeline and persists three Redis blobs
  per epoch: public snapshot DTO, private per-wallet lookup map, and an operator-only DTO. Reads:
  `readSnapshot`, `readOperator`, `readWalletValue`. **This is the "tracking" backbone** — it already computes
  sales, points, bonuses, the XCH-slice accounting, and an (approximate) holder snapshot for the drip.
- `snapshotSerialize.ts` — DTO serializers (public strips the operator numbers).

Endpoints + UI that exist:
- `GET /api/rewards/operator` — operator-authed (`REWARDS_OPS_SECRET`, timing-safe, 404s on bad key or flag
  off) read of the operator plan for the latest epoch.
- `GET /api/rewards/snapshot`, `/api/rewards/cron`, `/api/rewards/lookup`, `/api/rewards/lp`, `/snapshot`.
- `RewardsDashboard.tsx` — leaderboards + operator-only panel (flag-gated).
- `opsAuth.ts` — timing-safe SHA-256 secret compare (Bearer header or `?key=`).

Flags: `REWARDS_SHADOW` (compute + read shadow), `CRON_SECRET` (cron auth), `REWARDS_OPS_SECRET` (operator
routes), `REWARDS_LAUNCH` (gates real payout intent). Shadow-first is fully wired.

---

## What is MISSING (the glue to build — in the owner's order)

1. **Operator-triggered CLOSE.** Today the snapshot is recomputed by a cron (`status: "mtd"` running total,
   `status: "final"` write-once). There is no operator action that says "close epoch N now, freeze it, and
   stamp it final." Need: an operator-authed `POST /api/rewards/close` that runs the pipeline once with
   `status:"final"` at an operator-chosen `payoutAt`, records the epoch as `closed`, and refuses to reopen.

2. **Single downloadable settlement manifest.** The pieces exist (operator plan + per-wallet payable table +
   drip allocation + hashing) but nothing assembles them into ONE labeled JSON the operator downloads. Need a
   pure `settlementDoc.ts` builder + an operator-authed `GET /api/rewards/manifest?col&epoch` that returns:
   XCH to move to the fresh distribution wallet broken out by purpose (swap→$CHIA / swap→buy&burn / artist
   cut), $CHIPS from treasury for the holder drip, the full per-wallet distribution table (address, amounts,
   reason breakdown), epoch id + totals + a hash of the recipient list.

3. **Epoch lifecycle / paid state.** No registry of epoch status (open → closed → manifest-generated → paid)
   and no `paid` badge. Need a small Redis-backed `epochRegistry.ts` + status surfaced on the dashboard.

4. **Receipts channel.** The bot has nowhere to post back "epoch N paid, here are the tx ids." Need an
   operator/bot-authed `POST /api/rewards/receipts` that records receipts and flips the epoch to `paid`.

5. **Runnable local bot (OWNER-BLOCKED).** `bot.ts`/`botDeps.ts` exist as logic but there is no CLI a person
   runs on their machine: verify hash + signature → verify guards → dry-run (default) → operator confirm →
   send via wallet RPC → write idempotency ledger → post receipts. Needs the owner's wallet RPC endpoint,
   fingerprint, and asset-id whitelist — see QUESTIONS.md.

6. **Swap step (OWNER-BLOCKED, decision).** No XCH→$CHIA swap code. **Recommendation: owner does the one swap
   manually** and enters the actual $CHIA received; the percent-of-pot split (`distributeChia`) absorbs
   whatever slippage happened. This is more robust than automating a DEX swap from the bot (no slippage/partial
   -fill/failed-swap edge cases in the money path, and it keeps the "app never moves funds" line clean). If the
   owner later wants automation, it can be added behind the same manifest without changing the payout math.

---

## Collection-ID generalization (cheap-to-keep seam)

The pipeline is already `colId`-parameterized (`computeRewardsSnapshot(colId, …)`, all Redis keys namespaced by
collection, the operator route accepts `?col=`). The **one real correctness seam**: `PayoutManifest` and its
`paymentKey` omit `colId`, so two collections that ever shared an epoch id could collide in the bot's
idempotency ledger. Harmless today (MisFitz only) but it should be added when the manifest glue is built, since
it is a one-field change now vs. a migration later. `consts.ts` hardcodes `MISFITZ_COLLECTION_ID` as the
default — fine as a default, as long as nothing assumes it's the *only* collection. **Do not build multi-tenant
now**; just keep `colId` a first-class field everywhere new code touches.

---

## Recommended build order (matches owner's)

tracking (epoch registry + operator close) → manifest (settlementDoc + download endpoint, +colId in manifest)
→ dashboard (close button, download link, paid badge) → bot (CLI, owner-blocked) + receipts.

Shadow-first throughout: every new endpoint runs against the already-live shadow snapshot data, so an epoch can
be closed and its manifest downloaded and inspected on real numbers **before any payout path is wired**.
