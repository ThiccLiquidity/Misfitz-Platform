# Traitfolio — Launch Readiness

_Last updated by the overnight launch-prep pass. Read this first when you're back._

This document covers (1) what the app now has for launch, (2) the things **only you can do** before going
live, (3) recommended-but-optional polish, and (4) known limitations / the next engineering phase.

---

## 1. What this session added (done, committed, tsc + tests green)

**Mobile**
- Explicit viewport (`device-width`, `viewport-fit: cover` for iOS safe areas) + browser theme-color.
- Reusable `MobileFilterSheet` bottom sheet wired into the wallet binder **and** the collection binder —
  both now expose sort/tier/trait (and shop) filters on a phone. Previously only the collection shop did.
- Value-explainer (ⓘ) and the trending-trait row are now **tap-to-toggle** (hover doesn't exist on touch).
- Bigger touch targets (modal close, nav links, wallet chip remove) + bottom safe-area padding.
- Tier stats bar is a **3×2 grid on mobile** so long labels ("LEGENDARY", "UNCOMMON") stop smashing together.

**Production readiness**
- `next.config` now allows all HTTPS image hosts. NFT art comes from arbitrary IPFS/Arweave/CDN hosts via
  the `data_uris` fallback, and a **production build hard-errors** on any non-allowlisted host. This was a
  real launch blocker.
- `[binder-perf]` debug logs are gated to non-production, so prod logs stay clean (still print in `dev`).

**Robustness**
- `not-found.tsx` (404), `error.tsx` (route error boundary + "Try again"), `global-error.tsx` (root
  boundary) — a thrown error or bad URL now shows a friendly page, never a raw crash.

**Trust / legal**
- Global footer with the estimate/legal disclaimer: informational only, not financial advice, Traitfolio is
  independent (not affiliated with MintGarden/Dexie/Chia), never holds funds or executes trades.

**SEO / sharing**
- Rich root metadata (title template, keywords, favicon/apple icon), Open Graph + Twitter cards with a share
  image, per-page titles for Browse / Your Binder, and dynamic `generateMetadata` on collection pages (uses
  the collection's name + thumbnail).
- `robots.ts`, `sitemap.ts`, `manifest.ts` (PWA basics).

**Accessibility** — verified alt text on all images, aria-labels on icon buttons, aria roles on modals/lightbox.

---

## 2. Before launch — things only YOU can do

### 2a. Blockers (the app won't be fully correct in production without these)

- **Legacy auth needs secrets _or_ removal.** The app still contains NextAuth (`/api/auth/[...nextauth]`,
  `/api/signup`, `/api/wallet/*`) from before it became a no-login product. In production NextAuth requires
  `NEXTAUTH_SECRET` and `NEXTAUTH_URL` or it errors. **Decision needed:** either (a) set those env vars, or
  (b) have me remove the unused auth stack (cleaner, since the product is no-login now). Flagging rather than
  ripping it out autonomously — that's a product call.
- **Set `NEXT_PUBLIC_SITE_URL`** to your real origin (e.g. `https://traitfolio.app`) in production. Open Graph
  image URLs, `robots.txt`, and `sitemap.xml` all use it; without it they point at `localhost`.
- **Prisma database.** The seeded "demo/Misfitz" fallback and the legacy wallet tables use Prisma (`DATABASE_URL`).
  In prod you must provision the DB and run migrations, or drop the Prisma-backed paths if unused.
- **Verify the production build on your machine.** I can't run the Next SWC compiler in my sandbox, so I gate
  on `tsc` + unit tests. Run `npm run build` locally once — it should pass; if anything surfaces, send it to me.

### 2a-gate. Valuation backtest — the LAUNCH GATE (validate against reality)

Everything else in the valuation review was reasoning; this is the one step that checks the model against
real outcomes, so hold launch behind it. A harness is written and ready:

```
npx tsx scripts/backtest-valuation.ts col1<yourCollectionId> [--max=800]
```

For every past clean XCH sale it rebuilds the comps model from ONLY the sales before that sale
(leave-future-out), estimates the NFT's value at that moment, and compares to the actual sale price. It
prints median/mean absolute % error and hit-rates (±25% / ±50%), and — folding in the other open item —
**counts how many real sales the [0.2×, 5×] baseline clamp would have clipped**, so you can confirm the
clamp bounds catch wash/outliers and don't clip legitimate grail buys.

What to do: run it on 2–3 real collections (ranked and unranked). If error is reasonable and clamp clips
are dominated by genuine outliers/wash (not normal sales), the model is validated — otherwise tune
`baselineClampHi` / the ridge / half-lives and re-run. This needs your machine (network + live APIs); I
can't run it from here.

### 2b. Hosting + domain

- **Pick a host.** Next.js App Router deploys cleanly to **Vercel** (recommended, zero-config). A Node host
  (Railway/Render/Fly/VPS) also works with `npm run build && npm start`.
- **Caveat about the on-disk caches (important).** Two caches live on the server's local disk:
  `.cache/traitfolio-cache.db` (SQLite: NFT/collection/sales/holdings) and `.rarity-cache/*.json` (our computed
  ranks). These are **per-instance and need a writable, persistent disk.**
  - Vercel's serverless functions have an **ephemeral, read-mostly** filesystem — the caches won't persist and
    every cold start re-fetches. It'll still _work_ (guarded to fall back to network) but you lose the speed win.
  - For the caching to actually pay off in production, either deploy to a host with a persistent disk, or do the
    Phase 2 migration below (move the caches to shared storage). Happy to do that next.
- **Domain + DNS**, then set `NEXT_PUBLIC_SITE_URL` and `NEXTAUTH_URL` (if keeping auth) to match.

### 2c. Legal / content

- **Have someone review the disclaimer** in the footer, and add a **Terms** and **Privacy** page if you want
  formal coverage. Privacy note worth stating: the app stores pasted wallet addresses in the browser's
  `localStorage` only (no server account), and reads public on-chain data.
- **A dedicated 1200×630 branded share image.** Right now OG uses `/brand/landing-hero.png`, which works but
  isn't purpose-built. A proper share card makes links look sharp.

---

## 3. Recommended (optional) polish

- **Analytics** — a privacy-friendly option (Plausible/Umami/Vercel Analytics) to see traffic. Needs an account.
- **Rate-limit / abuse guarding** — the public MintGarden/Dexie APIs can throttle under a launch spike. The
  cache + background-only pacing mitigate this; consider an API key (if available) or a small per-IP limiter on
  the `/api/*` routes if you expect a surge.
- **Full a11y audit** — color-contrast check in both themes, keyboard-only nav pass, screen-reader spot check.
- **A real favicon set** (`.ico` + multiple PNG sizes) instead of reusing the logo mark.
- **Error monitoring** (Sentry or similar) so production errors reach you.

---

## 4. Known limitations / Phase 2 (engineering)

- **Single-instance caches.** As above — SQLite + `.rarity-cache` are local disk. To scale horizontally (multiple
  server instances) they must move to shared storage: Postgres (or the existing Prisma DB) for the write-through
  cache, and object storage or a DB table for the rarity tables. This is the natural "Phase 2 of the indexer."
- **Wallet cap.** Binders load up to `MAX_HOLDINGS` (120) NFTs per address and rarity scans cap at `MAX_NFTS`
  (2000) per collection — fine for launch, revisit for whales / huge collections.
- **Comps need sales.** Collections with little/no Dexie sales history get lighter, floor-anchored estimates
  (by design). Trending traits + the sale-driven curve only appear once there's enough data.
- **First visit to an unranked collection re-scores in the background** (then it's cached). Expected, not a bug.

---

## 5. Suggested pre-launch checklist

- [ ] Decide: keep auth (set `NEXTAUTH_SECRET`/`NEXTAUTH_URL`) or remove the legacy auth stack
- [ ] Provision `DATABASE_URL` + run Prisma migrations (or remove Prisma-backed paths)
- [ ] Choose host; confirm caches have a persistent disk **or** schedule Phase 2 shared-storage migration
- [ ] Buy domain; set `NEXT_PUBLIC_SITE_URL` (+ `NEXTAUTH_URL`) to it
- [ ] `npm run build` passes locally
- [ ] **Valuation backtest passes** (`npm run backtest col1…`) on 2–3 real collections — error acceptable AND clamp clips are outliers/wash, not legit sales (the launch gate)
- [ ] Legal review of disclaimer; add Terms/Privacy if desired
- [ ] (Optional) branded 1200×630 OG image, analytics, error monitoring
- [ ] Smoke test on a real phone (binder, collection, filters, buy links go out to Dexie/MintGarden)
- [ ] Deploy → verify OG preview (paste your URL into a link-preview tester)

---

## Environment variables (reference)

| Var | Needed for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | OG images, robots, sitemap | Set to prod origin. Defaults to localhost. |
| `DATABASE_URL` | Prisma (demo fallback + legacy auth) | Provision + migrate in prod. |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Legacy NextAuth | Required if auth stays. |
| `WALLET_VERIFIER` | Wallet-verify mode | `mock` unless real BLS wired. |
| `NEXT_PUBLIC_WC_PROJECT_ID` / `NEXT_PUBLIC_WC_CHAIN` | Sage WalletConnect | Only if wallet-connect is used. |
| `VALUATION_COMPS_ENABLED` | Comps blend feature flag | On by default in code. |
| `MINTGARDEN_API_BASE` | Override MintGarden API base | Optional; has a default. |
