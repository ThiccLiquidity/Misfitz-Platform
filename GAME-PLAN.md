# Traitfolio — Big-Day Game Plan

Deep dive + roadmap across five workstreams: (1) badge/bonus timing, (2) genesis airdrop finish,
(3) Nostalgia Mode, (4) wallet-connect "buy on site", (5) bulk listing. Owner decisions flagged **[DECIDE]**.

---

## 1. Badge → bonus timing — **you're already right, with one refinement**

**What the "badge" + "bonus" are.** The badge is the site's **deal-score** color on each card (buyer got a
steal → buyer-favored; seller sold over value → seller-favored; else fair). The **bonus** is a 2.5% reward
(`bonusBps: 250`) paid to whichever side "won" the deal on a sale, decided by `bonusWinnerFor(priceXch, fv)`
(`src/lib/rewards/detect.ts`): deal score ≥ 60 → **buyer bonus**, < 40 → **seller bonus**, else none (that
slice goes to burn).

**Your question — purchase-time or listing-time?** The bonus is already computed from the deal **at the
purchase**, NOT at listing. It is **frozen per sale**: `tagStore.freezeInto` stamps each sale's fair value
once (`FrozenTag { fvXch, priceXch, capturedAt, soldAt }`), keyed by the Dexie offer id, and **never
recomputes it** (`detectLive.ts:164`). The listing-time deal badge is display-only and does not feed the
bonus. So your instinct is already the implemented design. ✅

**The one gap (worth fixing).** The fair value is frozen at **first detection by the cron** (`capturedAt =
now`), which can be up to one cron cycle AFTER the actual sale (`soldAt`). If the market moves between the
buy and the cron seeing it, the frozen value drifts slightly from the true purchase-moment value. The store
already records `soldAt` — it just isn't used to time the valuation.

**Recommendation.** Keep purchase-based freezing (correct). Tighten *when* we freeze so it's as close to
`soldAt` as possible:
- **Cheapest:** hook freezing onto the existing event-driven new-sale probe (`refreshCompsIfSold`) so a sale
  is valued within ~one probe of completing, not the next daily cron. Small change, big precision win.
- **Most precise (later):** value as-of `soldAt` from a short rolling FV history per NFT. More work; only
  worth it if drift proves material in shadow.
- Either way: **document the rule** ("bonus = deal at the moment of purchase, frozen; listing badges never
  affect rewards") so it's unambiguous to holders. **[DECIDE]** cheapest-now vs precise-later.

---

## 2. Genesis airdrop — **finish the runnable path**

Built + tested this session: `buildLaunchAirdrop` (rarity-weighted, project-wallet excluded, solvent) +
`finalizeAirdropManifest`. Remaining to be "fully runnable when the mint sells out":
- **Preview command** (safe, no decision) — a CLI that runs the airdrop against the CURRENT holders and
  prints the table + total + excluded set, so you can eyeball it any time. I can build this now.
- **Live final-holder snapshot** — a fresh full-scan → freeze path (reuses the roster infra) that produces
  the immutable airdrop roster on launch day.
- **Epoch-manifest sentinel** (bot hardening) — makes "the airdrop can only pay once" structurally true even
  against a re-cut manifest (Fable's P1-2). Touches the hardened bot core; do it as its own reviewed change.
- **Owner inputs** (blocking the actual send): minted **$SNACKZ tail id**, **project wallet address(es)** to
  exclude, **distribution wallet fingerprint**, and confirmation **Misfitz is fully distributed**.

**Plan:** I build the preview + live-snapshot + sentinel now (all no-send). You provide the four inputs when
the mint sells out; then it's freeze → dry-run → send.

---

## 3. Nostalgia Mode — **~1 day of code from user-facing**

State: a CSS-only 90s-binder skin is **built and hidden behind a flag** (`ThemeMode: "nostalgia"`, palette in
`themes.ts`, a `[data-theme="nostalgia"]` block in `globals.css`). No component rewrites needed — everything
already reads the CSS vars. To finish the **code**:
- **Accessibility contrast pass** on the manila/brown palette (required before user-facing).
- **Expose the toggle** (add it to the theme switcher) — **[DECIDE]** ship it as a third public theme?
- The **"dream" art version** (real wood desk, spiral binding, pogs, CRT glow) is gated on **commissioned
  art**, not code — a separate spend. The prototype already exposes the seams so art drops in without a
  rewrite. **[DECIDE]** commission art now, or ship the CSS-only skin first?

Low risk (additive, hidden, CSS-only). Good "delight" launch once contrast passes.

---

## 4. Wallet-connect "buy on the site" — **the big product decision** **[DECIDE]**

**Today:** buy actions **link OUT** to Dexie/MintGarden; CLAUDE.md states the app *never holds funds or signs
transactions*. There IS already a wallet-connect scaffold (`src/lib/wallet/connect/`, a Sage connector over
WalletConnect v2) — but it's wired for **identity** (sign a challenge / read address), not trading. Goby is
deliberately deferred (Chia security notice re: Raccoon Stealer).

**What "buy on site" actually means (non-custodial):** the site relays a **take-offer** request for a Dexie
offer to the user's OWN wallet over WalletConnect; **the user approves and their wallet executes**. The app
never holds funds, never holds keys, never signs — it facilitates, the user's wallet does the spend. This is
the standard non-custodial marketplace pattern and keeps "the app never moves funds" TRUE in the custodial
sense, but it IS a shift from "link out only," so it's a **product-vision change to make deliberately**.

**Feasibility:** good. Sage's WalletConnect supports offer commands; the connector already exists. Work:
extend the connector with `takeOffer`, a buy button that fetches the Dexie offer + hands it to the wallet, and
clear UX (price, royalty, "you're approving this in YOUR wallet"). Medium build.

**Guardrails I'll hold to:** the app never auto-executes, never batches spends without per-action user
approval in-wallet, always shows the full cost + royalty before the wallet prompt, and keeps the "link out"
path as a fallback. I will not build anything that moves funds without the user's in-wallet approval.

**[DECIDE]:** (a) do we shift the vision to on-site buying at all? (b) if yes, Sage-only to start (Goby stays
deferred for safety)?

---

## 5. Bulk listing — **natural companion to #4** **[DECIDE]**

Doesn't exist today. "Bulk listing" = select several owned NFTs and create Dexie offers for all of them in one
flow. Same machinery as #4 (WalletConnect + Sage create-offer), just the sell side, and again **non-custodial
— the user signs each offer in their wallet**. Depends on #4's connector work. Sensible sequence: land buy-on-
site first, then add bulk listing on the same rails. **[DECIDE]** in-scope this cycle, or after buy-on-site
proves out?

---

## Recommended sequence
1. **Now (no decisions needed):** airdrop preview + live-snapshot + epoch-sentinel; badge-freeze precision fix
   (cheapest hook) + document the rule; Nostalgia accessibility pass.
2. **Quick decisions → fast wins:** ship Nostalgia as a third theme (if yes); confirm badge fix scope.
3. **Bigger call:** wallet-connect buy-on-site (vision shift) → then bulk listing on the same rails.
4. **Owner-blocked (whenever):** mint $SNACKZ, provide the 4 airdrop inputs, fire the genesis airdrop once
   Misfitz is fully distributed.
