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

## 5. Sale eligibility (from the write-up; detection round still OPEN)
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
- Sale detection & attribution: buyer/seller/price extraction, finality, bundles, auctions, offers moving
  several NFTs, CAT-priced sales (excluded), MintGarden-vs-chain reconciliation.
- Airdrop + monthly drip: rank→weight parabola mapping (reuse valuation curve), per-NFT vs per-wallet, the
  snapshot block rule.
- $TOKEN: TAIL, burn mechanism (melt vs send-to-unspendable), LP seeding, TibetSwap depth vs monthly buy
  (needs expected monthly MisFitz XCH volume).
- Bot & manifest: API auth (token + IP allowlist), idempotency ledger, asset-ID whitelist, hard caps, dry-run.
- Shadow mode: 1–2 epochs of visible points + published reports + ZERO payouts before real money.

## 8. Architecture (target)
- **Traitfolio server:** indexes sales, freezes FV/tags, computes points + $CHIA percentages, holder
  snapshots, dashboard, publishes hash-verified immutable manifests. Never touches keys/funds.
- **Local bot (operator machine):** pulls manifest → verifies hash → dry-run → operator confirm → batch CAT
  sends via wallet RPC → idempotency ledger (no double-pay) → receipts back to dashboard.
- **Operator:** wallet funding, $CHIA buys, $TOKEN mint/LP/burn, sign-offs.

## 9. Built so far (isolated, NOT wired in, NOT pushed)
`src/lib/rewards/` — pure, dependency-free, imported by nothing in the app:
- `types.ts` — domain types; all money in **bigint mojos**.
- `engine.ts` — `perSaleSlices`, `computeEpoch` (payout + vest + solvency), `distributeChia`.
- `drip.ts` — 5% vs 10% drip simulator.
- `report.ts` / `format.ts` — human-readable epoch report.
- `mock.ts` / `demo.ts` — sample data + runnable shadow demo (`npx tsx src/lib/rewards/demo.ts`).
`tests/rewards/` — 17 tests: slice/solvency math, the Alice/Bob/Carol example, vest pay/void/equal/other-nft/
window/resale, drip curve numbers, 500-epoch solvency property, wash-trade net-negative property.

Verify locally: `npx tsc --noEmit` (clean) and `npm test` (all green).
