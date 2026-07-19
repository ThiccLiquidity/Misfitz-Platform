# MisFitz Rewards — Locked Spec & Decision Log

> Single source of truth for the MisFitz rewards system. Updated after each design round.
> **Status: DESIGN IN PROGRESS.** Only the reward-engine math is locked + built. Nothing is wired into the
> live app, nothing touches keys or funds, and nothing is on-chain yet. Do not build past what's LOCKED here
> without confirming with the operator.

## 0. Non-negotiables
- **Traitfolio never holds funds or signs transactions.** It indexes, computes, and publishes hash-verified
  payout manifests. All money movement is done by the operator's local bot with the operator's keys.
- **The build agent will not execute trades, transfers, or burns.** It builds the calculation/manifest/bot
  tooling; the operator executes every buy, burn, and send.
- **Legal review gates launch** (not build). Rewarding trading + an appreciating/deflationary token + buy&burn
  carry securities/AML/tax exposure that varies by jurisdiction. Get a crypto/securities lawyer before mainnet.

## 0.1 Design philosophy — the system is self-contained (LOCKED)
NFTs are **not** liquid tokens; a holder cannot instantly dump a bag at floor. So we do **not** defend against
drip-snapshot "sniping", and we won't add defenses:
- **Buying MisFitz at the snapshot is welcomed** — it's a new holder and (almost always) a royalty-paying sale.
- If a snapshot buyer then **lists cheap to flip**, that's just an underpriced NFT: a smart trader scoops it,
  **earns the buyer bonus**, and the sale pays royalty that funds the pot. The "dump" feeds the flywheel.
- Therefore: **no minimum-hold, no time-weighting, no randomized snapshot.** The holder drip and the trader
  rewards interlock, so gaming one only powers the other. Self-balancing by construction.

## 1. Two-token model
- **$CHIA** (reward CAT, third-party meme token) — paid to TRADERS. Asset ID
  `69326954fe16117cd6250e929748b2a1ab916347598bc8180749279cfae21ddb`
  = "VersaceFerrariVegasApartmentPatek9000Inu", verified on Dexie/TibetSwap. External dependency (not ours).
- **$TOKEN** (holder asset, ours) — fixed supply, single-issuance TAIL, airdropped + monthly drip, bought &
  burned on every sale. Name/TAIL TBD. Never sold or emitted to traders.
- Funded entirely by the **10% MisFitz royalty** (operator confirms the minted rate is exactly 10%).

## 2. LOCKED — Money split (per sale, as % of SALE PRICE)
Royalty = 10% of price. `price = royalty ÷ 10%`. Engine allocates fractions of the **actual royalty received**,
so it can never owe more than came in (solvent by construction, verified in tests).

| Slice | % of price | Destination |
|---|---|---|
| Artist | 1% | Creator wallet (operator takes it) |
| Buyer reward | 2.5% | Buyer of that sale |
| Seller reward | 2.5% | Seller of that sale |
| Deal bonus | 2.5% (tagged sales only) | Tag winner (buyer on green/steal, seller on premium/grail) |
| Buy & burn | remainder | Buys & burns $TOKEN — **4% on fair sales, 1.5% on tagged** |

Max out = 8.5% (1 + 2.5 + 2.5 + 2.5) vs 10% in → wash trading is always net-negative (proven in tests).

## 3. LOCKED — Payout formula
Each sale locks a **fixed, deterministic reward at sale time** (linear in sale size): buyer earns 2.5% of the
price, seller earns 2.5%, bonus winner earns +2.5%. Monthly, we sum each wallet's locked amounts, the operator
does **one $CHIA buy** with the whole reward pot, and everyone receives $CHIA proportional to their locked XCH
(slippage shared proportionally — no per-sale price feed). The XCH entitlement is locked per sale; the amount
of $CHIA it becomes depends on that one monthly conversion rate.

Worked example (2 sales): S1 = 100 XCH, Alice buys from Bob, green (Alice bonus). S2 = 40 XCH, Bob buys from
Carol, fair. → Alice 5.0, Bob 3.5, Carol 1.0 XCH; artist 1.4; burn 3.1; pot 9.5; total royalty 14.0. Exactly
solvent. (This is a unit test.)

## 4. LOCKED — Buyer-bonus vest ("no cheap dumps")
- The **buyer's** bonus is held until the **next monthly payout**.
- It is **voided** if, before that payout, the NFT is listed OR resold for **strictly less** than the buyer
  paid. Same-price or higher — or just holding — keeps it, any time, no downside.
- We watch the **NFT id**, not the wallet (alt-wallet dodges don't work).
- A **voided bonus goes to the burn** (a dumper's forfeited reward deflates $TOKEN for real holders).
- **Base buyer/seller rewards and the seller bonus are final** the instant the sale confirms — never clawed back.

## 5. LOCKED (shadow) — Sale eligibility & detection
**Detection round decisions (operator-confirmed):** source = **Dexie completed clean-XCH sales** (status=4, not
deduped — every sale in the window counts); royalty **trusted from the marketplace record in shadow mode**
(royalty = 10% of price), with **on-chain royalty-coin verification a REQUIRED gate before any real payout**;
deal tag (bonus winner) **approximated from the current comps model FV** at detection time. Built in
`src/lib/rewards/detect.ts` (pure) + `detectLive.ts` (live bridge) — see §9.

**Hardening (fable adversarial pass — APPLIED in shadow):**
- Finality window is now a **finality-shifted half-open partition** `[start-fin, end-fin)` — last-minute sales
  roll to the next epoch instead of being dropped by both (was an accounting hole).
- Sales **deduped by offer id** across pagination (live paging could double-count the same sale).
- **Bundle filter tightened**: require exactly ONE offered item (an NFT+CAT bundle no longer passes as clean).
- **Attribution price tolerance**: a MintGarden event only fills buyer/seller when within ~0.5% / 0.05 XCH of
  the sale price; otherwise the sale keeps a per-**offerId** placeholder (distinct unattributed people never
  merge). Loose price-only matching could have paid an ancient unrelated sale.
- **Retro-run payout time**: `runShadowEpoch` uses `payoutAt = max(now, epochEnd)` so list-voids are observed.
- **Truncation is now loud**: fetch failure / page-cap logs a warning (never silently reports a partial epoch).
- Engine fix: only the **buyer** bonus voids; the **seller premium bonus is final** (matches §4; was voidable).
- Every shadow report is stamped **"assumes 10% royalty — UNVERIFIED"**.
- **Deal tag FROZEN at first detection** (spec-compliant): each sale's fair value is stamped ONCE, keyed by
  offerId, in `rw:tags:v1:{colId}` (pure logic `tagStore.ts`, live read/write `resolveFvLookup` in detectLive).
  A green buy stays green even if the floor later moves. Only a RESOLVED valuation is stamped (a cold run can't
  freeze a wrong "none" — it retries); the cron is the SOLE writer (CLI is read-only); a write-once FINAL run is
  DEFERRED if the valuation model is down; entries pruned at 90 days.
- Ownership change WITH royalty paid in the same spend. No royalty = wallet shuffle = ignored.
- **XCH-denominated sales only** at launch. Bundles: base rewards only (no bonus).
- Finality: counts once ~10 min of blocks deep; late-epoch sales roll to next payday.
- FV + tag **frozen at the moment of sale**.
- Source: **MintGarden events primary**, raw coin/spend/block IDs stored for chain re-verification.

## 6. Recommendations PENDING operator confirmation
- **Custody:** dedicated ops wallet the operator solely controls now → 2-of-3 multisig once payouts scale.
  (Operator's royalty wallet is **commingled**, so solvency is verified from detected sales + on-chain
  royalty receipts, NOT from wallet balance.)
- **Ledger:** managed serverless Postgres (Neon/Supabase) via Prisma — separate DB from the NFT cache.
- **Chain verification:** MintGarden to detect; independent node (or node RPC) to re-verify each royalty coin
  before a sale counts.
- **Drip rate:** 5%/mo recommended (≈46% yr1, visible into yr3; boost-months stay possible). Simulator built.

## 7. OPEN — not yet designed (need decisions)
- Sale detection & attribution: **shadow path BUILT** (Dexie sales -> engine, buyer/seller via MintGarden
  events matched by price, 10-min finality, approx FV tags). STILL OPEN before real money: on-chain royalty +
  coin/spend/block provenance re-verification, bundles/auctions/multi-NFT offers, MintGarden-vs-chain reconciliation.
  - **On-chain royalty verification: BUILT (keyless gate).** `chainVerify.ts` (pure, tested) + `chainProvider.ts`
    (operator implements against their node/indexer): confirms the royalty coin actually paid the creator wallet,
    takes the ACTUAL royalty/price/buyer/seller/coin/spend/block from chain, requires min block depth, and only
    `verified` sales build a `provenance:"chain-verified"` reward manifest (rejects excluded from every pot).
  - **Remaining pre-money gates fable flagged (NOT yet built):** (b) timestamped
    attribution (add MintGarden event timestamps, match on time+price, else leave unpayable); (c) treat
    `unknown-*` placeholders as UNPAYABLE at the payout layer (route to holdback/burn, never a wallet);
    (d) void-signal feed from chain events (a cheaper resale via CAT / bundle / off-Dexie currently escapes the
    void); (e) list-void owner check (a seller's stale cheap listing can grief a buyer's bonus); (f) per-sale FV
    snapshots + robust comps fit + per-wallet bonus caps (guards FV-pump gaming; solvency is NEVER at risk —
    a mis-tag only moves <=2.5% between a wallet and the burn).
- Airdrop + monthly drip: **ALLOCATION BUILT (shadow)** — rarity-weighted PER NFT (base 1 + valuation rarity
  curve), snapshot on a **FIXED date (1st of month)**, **listed NFTs count**. Pure `allocator.ts` (solvent by
  construction) + live `allocatorLive.ts` snapshot. STILL OPEN before real money: pin the 1st-of-month snapshot
  to a deterministic block/time so the manifest is REPRODUCIBLE and auditable (this is about determinism, NOT
  anti-sniping — per §0.1 we welcome snapshot buyers); set the actual monthly drip units from the TAIL/drip
  schedule; decide initial-airdrop size vs ongoing drip.
- $TOKEN: TAIL, burn mechanism (melt vs send-to-unspendable), LP seeding, TibetSwap depth vs monthly buy
  (needs expected monthly MisFitz XCH volume).
- Bot & manifest: **MANIFEST TOOLING BUILT (shadow, pure)** — canonical hash-verified payout manifests
  (`manifest.ts`), the verify guard (hash integrity + asset whitelist + no-unattributed + no-duplicate + funding
  cap + max-recipient-share, `manifestGuard.ts`), the idempotency ledger (per-payment keys so a re-run never
  double-pays), and the dry-run formatter. Decision: **unattributed rewards route to BURN** (`settle.ts`), and
  the guard applies **sensible default caps** (payouts can't exceed funding; no single recipient > 25%).
  STILL OPERATOR-SIDE (needs keys): the wallet-RPC sends, persistent ledger storage, the operator confirm UI, and
  the RoyaltyChainProvider (node/indexer). The keyless BOT ORCHESTRATOR is BUILT + tested: `bot.ts` (`runBotPayout`:
  verify→recover→conflict-halt→confirm→sequential write-ahead sends) + `botDeps.ts` interfaces + `BOT-CONTRACT.md`.
  Hardened per fable security pass: manifest gained a SIGNATURE seam (`signManifest` + guard `verifySignature`
  option — the hash is integrity, the signature is authenticity, REQUIRED before real sends; operator wires the
  key); the ledger is now AMOUNT-AWARE (a re-run with a changed amount is a conflict, not a silent under/double
  pay) with injection-safe JSON keys; the guard enforces version/kind, recipient-asset == header-asset, a wallet
  ALLOWLIST (xch1/did:chia), a REQUIRED funding cap for rewards, and a 90% hard concentration cap (2+ payees);
  `token.ts` refuses impossible rates/months/burns; `settle.ts` has a runtime solvency assert.
  BEFORE REAL PAYOUTS (bot-side, fable): make the signature check MANDATORY on the send path (pass
  verifySignature), have the bot invoke assertSettlementSolvent and refuse to send while any ledger `conflicts`
  are unresolved, and persist the ledger write-ahead (record intent -> send -> record done) so a crash can't
  double-pay.
- Shadow mode: 1–2 epochs of visible points + published reports + ZERO payouts before real money.
- Live SHADOW dashboard (BUILT, flag-gated OFF by default via `REWARDS_SHADOW`): a cron (`/api/rewards/cron`,
  CRON_SECRET, daily) computes a month-to-date snapshot (and the previous month's write-once FINAL on the 1st-2nd)
  and caches ONE public blob + a private per-wallet map; `/api/rewards/snapshot` (edge-cached, 404 when off) +
  `/api/rewards/lookup` feed a client dashboard on the MisFitz collection page (trader totals, holder drip,
  operator "send X XCH" panel, paste-a-wallet lookup). Client imports ONLY the DTO types — zero engine code in
  the browser. Fable-reviewed; fixed: write-once-final pointer bug, fresh+retry attribution, background pacing,
  don't-publish-empty-roster. Pre-launch (fable notes): install `server-only`, normalize DID/xch1 lookup keys,
  and the operator env: set `REWARDS_SHADOW=1` + `CRON_SECRET` (+ optional `REWARDS_LAUNCH=YYYY-MM` for the drip month).


## 10. LOCKED — $TOKEN supply model
Fixed supply **1,000,000,000 $TOKEN** (Chia CAT, 3 decimals). Single-issuance TAIL (name/TAIL id TBD).
| Bucket | % | Amount | Purpose |
|---|---|---|---|
| Airdrop | 10% | 100,000,000 | one-time to holders at launch |
| Drip pool | 80% | 800,000,000 | monthly drip reserve |
| LP seed | 7% | 70,000,000 | seed TibetSwap liquidity |
| Team | 3% | 30,000,000 | operator/whale stake |

- **Monthly drip: 5% of the REMAINING pool** (geometric — ~46% of the pool out in year 1, long tail). Month N's
  drip is the `dripUnits` the allocator (§ allocator.ts) splits across holders.
- **Burn = buy-back then SEND to an unspendable address** (no melt; works with a locked single-issuance TAIL).
  The XCH burn pot buys $TOKEN on-market and the bot sends it to `burnAddress` (TBD); burned amount is reported
  like the $CHIA conversion. Voided buyer bonuses also fund this burn.
- Built pure + tested in `src/lib/rewards/token.ts` (supply reconciles by invariant; exact bigint base units).

## 8. Architecture (target)
- **Traitfolio server:** indexes sales, freezes FV/tags, computes points + $CHIA percentages, holder
  snapshots, dashboard, publishes hash-verified immutable manifests. Never touches keys/funds.
- **Local bot (operator machine):** pulls manifest → verifies hash → dry-run → operator confirm → batch CAT
  sends via wallet RPC → idempotency ledger (no double-pay) → receipts back to dashboard.
- **Operator:** wallet funding, $CHIA buys, $TOKEN mint/LP/burn, sign-offs.

## 9. Built so far (isolated, NOT wired in, NOT pushed)
`src/lib/rewards/` — imported by nothing in the app; moves no funds, touches no keys:
- `types.ts` — domain types; all money in **bigint mojos**.
- `engine.ts` — `perSaleSlices`, `computeEpoch` (payout + vest + solvency), `distributeChia`.
- `detect.ts` — **PURE** detection mapping (Dexie sale -> engine `Sale`, deal-tag -> bonus winner, window/
  finality, vest signals). Unit-tested, no network.
- `detectLive.ts` — **live bridge** (the one rewards file that imports the app data layer): fetch Dexie epoch
  sales, attribute buyer/seller via MintGarden events, approx FV via comps, `runShadowEpoch`. Not unit-tested
  (run manually against real data).
- `drip.ts` — 5% vs 10% drip simulator.
- `report.ts` / `format.ts` — human-readable epoch report (incl. operator actions).
- `operator.ts` — PURE operator action plan: the exact XCH to move royalty-wallet -> hot wallet before
  distribution (= reward pot + burn pot; the 1% artist cut stays put). Invariant: move + keep == total royalty.
- `allocator.ts` — PURE $TOKEN drip allocator: rarity-weighted per NFT (reuses the valuation rarity curve),
  exact bigint proportional split, dust to the largest holder. Solvent: sum(allocations) == dripUnits.
- `allocatorLive.ts` — live holder snapshot (roster owner + rank) feeding the allocator. `dripRun.ts` — runnable
  drip preview (`npx tsx src/lib/rewards/dripRun.ts`).
- `token.ts` — PURE $TOKEN supply model: 1B fixed supply, buckets (reconciled), geometric monthly drip, buy-&-burn
  circulating-supply accounting. Exact bigint base units (3 dp).
- `settle.ts` — routes unattributed (`unknown-*`) rewards to the burn before the $CHIA buy (solvency preserved).
- `manifest.ts` — canonical, sha256 hash-verified payout manifests (reward $CHIA + drip $TOKEN) + dry-run format.
- `manifestGuard.ts` — verify guard (integrity + whitelist + caps + no-unattributed) and the idempotency ledger.
- `chainProvider.ts` / `chainVerify.ts` — on-chain royalty gate (operator provider + pure verifier): verified
  sales' actual royalty/price/buyer/seller/coin/spend/block REPLACE the shadow assumptions; only verified sales
  fund a `chain-verified` reward manifest. `tagStore.ts` — frozen-deal-tag store (per-sale, first-seen).
- `finalize.ts` (pure) / `pipeline.ts` (live) — the REAL monthly flow: `prepareRewardEpoch` (detect->freeze->
  verify->settle->operator plan) then `finalizeRewardManifest`/`finalizeDripManifest` (sign after the buy).
- `botDeps.ts` / `bot.ts` — the keyless bot orchestrator (see BOT-CONTRACT.md).
- Fable fix (B1): the operator plan is derived from the SETTLEMENT (`operatorPlanFromSettlement`) so unattributed
  XCH is BURNED, never converted to $CHIA and paid out. Applied to the pipeline, dashboard panel, and CLI report.
- `mock.ts` / `demo.ts` — sample data + runnable shadow demo (`npx tsx src/lib/rewards/demo.ts`).
`tests/rewards/` — 42 tests: slice/solvency math, the Alice/Bob/Carol example, vest pay/void/equal/other-nft/
window/resale, drip curve numbers, 500-epoch solvency property, wash-trade net-negative property, and detection
mapping (XCH exactness, deal-tag thresholds, royalty math, window/finality, detect->engine vest-void).

Verify locally: `npx tsc --noEmit` (clean) and `npm test` (all green).

---

## 11. $TOKEN LP Rewards (tenure-escalating LP airdrop) — DESIGN LOCKED, shadow-first, NOT built

Goal (owner): incentivize people to hold $TOKEN/XCH liquidity. Reward anyone who holds LP, at any amount, and
make the airdrop **progressively bigger the longer they hold** — without letting anyone game it, and without ever
holding user funds or locking/withholding their rewards.

### 11.1 Allocation change (see token.ts)
Supply stays 1,000,000,000 $TOKEN. Re-split so LP rewards come mostly out of the holder drip:

| Bucket | Was | Now | Purpose |
|---|---|---|---|
| Airdrop | 10% (100M) | 10% (100M) | one-time holder airdrop at launch |
| Holder drip | 80% (800M) | **67% (670M)** | monthly rarity-weighted drip to MisFitz holders |
| LP seed | (part of 7%) | **5% (50M)** | one-time: pair with XCH to CREATE the TibetSwap $TOKEN/XCH pool |
| **LP rewards** | — | **15% (150M)** | the tenure-escalating LP-holder airdrop reserve |
| Team | 3% (30M) | 3% (30M) | operator/team |

Owner accepted the trade-off: the plain holder gift drops 80% -> 67% to fund deep, sticky liquidity.

### 11.2 The mechanic
- **Paid monthly, from day 1. Nothing is ever locked, withheld, or forfeited.** Everyone holding LP gets a share
  of that month's LP-reward release right away.
- Per-wallet weight each month = **time-weighted average LP balance that month (TWAB) x tenure multiplier**.
- **Tenure multiplier** grows every consecutive month the wallet holds LP, and **resets to 1x if the wallet fully
  exits** (LP balance -> 0). You keep everything already paid; you just restart the climb.

  | Months held (continuous) | Multiplier |
  |---|---|
  | 1 | 1.0x |
  | 3 | 1.5x |
  | 6 | 2.5x |
  | 12 | 4.0x |
  | 18+ | 5.0x (cap) |

  Net effect: a steady holder's monthly airdrop grows on its own as their multiplier rises while newcomers sit at
  1x. Short-term holders still earn the 1x base; long-haul holders compound toward 5x.

### 11.3 Anti-gaming (no lockups needed)
- **TWAB over the daily cron snapshots** kills just-in-time liquidity — spiking LP right before a snapshot and
  pulling after earns ~1/30 weight, not a full month.
- **Exit resets the multiplier**, so bail-and-return farmers stay stuck near 1x forever.
- **Linear in amount** -> sybil-neutral (splitting across N wallets earns the same).
- **Roster-gated**: only wallets that also hold a MisFitz NFT qualify — real illiquid capital behind every wallet,
  and it keeps the program collector-first (no MisFitz, no LP bonus). No registry, still no-login.
- **Operator/team/seed wallets excluded** from the census and the public leaderboard.

### 11.4 Burn -> LP burn (accepted)
The royalty burn pot may buy $TOKEN, pair it with XCH, and send the resulting **LP tokens** to the burn address.
Same permanent removal from circulation, but now as permanent, unpullable pool depth. Funded by the royalty flow,
costs nothing from the 150M. (Amends the §2 "buy & burn" wording — logged as an accepted change.)

### 11.5 Honesty + legal rails (non-negotiable, from the Fable review)
- **Never show APR/APY or any % yield.** Only an absolute "this month's thank-you: N $TOKEN", like the drip.
- **Mandatory plain-English IL gate** before any LP numbers render: providing liquidity converts half your XCH to
  $TOKEN; if $TOKEN falls, the position is worth less than holding XCH; the thank-you does not protect you. One
  acknowledge click (localStorage).
- **Show live impermanent loss** (your LP worth now vs. if you'd just held) from the pool reserves.
- **Never solicit.** The LP tile appears only for wallets already holding LP, plus one info page. No banners,
  countdowns, or onboarding nudges. Reward follows a choice; it never induces one.
- **Legal:** LP emissions look more like "yield farming" than the holder drip — a named line item for counsel.
  Nothing leaves REWARDS_SHADOW=1 until cleared.

### 11.6 Technical dependency (what still needs building)
- Pool composition + LP-token supply: TibetSwap API `GET /pairs` gives `liquidity_asset_id`, reserves, and LP
  supply in one cached call (verified). The $TOKEN pair won't exist until the operator seeds it (LP seed bucket).
- Per-wallet LP-CAT balance: needs a Chia full-node / Coinset (`get_coin_records_by_hint`) or Spacescan
  integration — same class as the on-chain royalty verifier (chainProvider.ts). MintGarden/Dexie can't do it.
- New `lpObserve.ts` records each roster wallet's LP balance on the daily cron; the FINAL run computes TWAB x
  tenure and feeds `{wallet, weight}` into the existing `allocateDrip()` (no allocator change). Rides the existing
  drip manifest/bot. DID pastes resolve to xch1 first (CATs are address-held).

### 11.7 Rollout
SHADOW-first, exactly like trader rewards: two preview epochs with published "would-have-earned" numbers and
**zero payouts**, behind REWARDS_SHADOW, legal-gated. Not started — this section is the captured design.

### 11.8 Build status + fixed issues + known limitations (Fable review)
Built shadow-first (behind REWARDS_SHADOW): `lpMath.ts` (pure: tenure curve, TWAB, `rollLpEpoch`), `lpPool.ts`
(TibetSwap parse + position value), `lpProvider.ts` (LpChainProvider + Null/Mock providers + `fetchTokenPair` +
`lpExcludedWallets`), `lpJob.ts` (observe daily / compute monthly), `lpTypes.ts`, `/api/rewards/lp`, cron +
dev-compute wiring, dashboard LP section with the IL acknowledge gate. Tests: `lpMath.test.ts`, `lpPool.test.ts`.

Fixed from the first Fable pass: **B1** obs/tenure now read+write with the LARGE cache API consistently (were
mismatched -> pipeline was a silent no-op); **B2** operator/team/seed exclusion via `LP_EXCLUDED_WALLETS`;
**B3** absent-wallet tenure now resets (rebuilt from the prev+observed union) with a data-outage guard; **S2**
TWAB = sum / global-run-count (part-month holders diluted); **S4** tenure curve matches the locked table
(1/1.5/2.5/4/5); **S7** tenure persisted before the snapshot; **S8** bounded-concurrency observe; **S9** a CONTINUITY CAP - only tenure is PER-UNIT via COHORTS - each chunk of liquidity ages on its own clock, so capital added this month starts at 1x and only reaches 5x after ITS OWN 18 months (a second Fable pass showed a single-slot cap only delayed the exploit one month; cohorts close it fully). Reductions trim NEWEST units first so aged units keep tenure; matured cohorts merge at the cap. **S2** a FINAL tenure-write failure now aborts before the snapshot is written (the cron's already-final guard can't mask a lost advance); **S3** persisted balances clamp non-negative.

Known limitations / pre-real-payout follow-ups (documented, not yet done): **S1** a per-wallet provider error
counts as a 0 that day (whole-epoch outage is guarded, partial isn't); **S3** the observe instant is the fixed
cron time (jitter or on-chain coin-lifetime TWAB later); **S5** `dripMonthFor` needs `REWARDS_LAUNCH` set before
real payouts, and the roll-forward-vs-burn of an epoch with zero eligible holders is undecided; **S6** DID-held
NFTs must resolve to their xch1 address before LP lookup; **S8** the observe loop needs checkpointing for a very
large roster under the 60s function cap. None of these can move funds while REWARDS_SHADOW is off; they're the checklist before the real on-chain LP
provider replaces NullLpProvider.

---

## Bonus timing rule (locked) — deal at PURCHASE, never listing
The deal bonus (buyer/seller, 2.5%) is decided by the deal score **at the moment of the buy**, using a fair
value **frozen per sale** (`tagStore`, keyed by Dexie offer id) that is **never recomputed**. The listing-time
deal badge is display-only and does NOT affect rewards.

To keep "at purchase" precise, a newly-detected sale now has its fair value frozen on the **event-driven sale
probe** (`freezeSaleTagsOnDetect`, fired from a collection view within ~minutes–hours of the sale) rather than
only on the daily cron — minimizing drift between `soldAt` and the value we stamp. The daily cron still
backstops. Both are flag-gated (`REWARDS_SHADOW`) and merge-safe (single logical writer via re-read + merge).
