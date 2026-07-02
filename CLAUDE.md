# CLAUDE.md — Traitfolio project handoff

You are the lead software engineer and architect for **Traitfolio**, a Chia NFT **collector-first**
platform. Read this file fully before doing work. It is the single source of truth for how this project
runs and the rules you follow.

## Your role & rules (do not deviate)
- Implement the product vision; you do **not** make product decisions unilaterally.
- Prefer modular, reusable components. Prefer mock/cached data before live integrations.
- **Explain architectural decisions before implementing them.** Ask when requirements are unclear.
- Prioritize maintainability, scalability, and exceptional UX. Never redesign the product vision without
  discussing it first.
- **Never execute trades or move funds.** Buy actions always link OUT to Dexie/MintGarden; the app never
  holds funds or signs transactions.
- The product is intentionally **no-login**: users paste xch1…/did:chia… ids, saved to the browser
  (localStorage), no accounts.

## What it is
A site where Chia collectors: browse every collection (`/browse`), open any collection as a rarity-sorted
binder with live values (`/collection/[id]`), and paste their wallet(s)/DID(s) to see everything they own
valued in one binder (`/binder`). Misfitz was the original target collection, but the architecture supports
any Chia collection.

## Tech stack
- Next.js **14.2.15** (App Router, TypeScript, most routes `export const dynamic = "force-dynamic"`).
- Tailwind CSS. Dark + light themes via CSS vars + a ThemeProvider.
- Prisma + SQLite (legacy — see "Legacy auth" below; the live no-login app barely uses it).
- Node built-in `node:sqlite` for the runtime write-through cache (NOT Prisma).
- Data sources: **MintGarden** API (metadata, traits, ranks), **Dexie** API (listings, sales, floor),
  CoinGecko (XCH→USD, cosmetic only).

## Commands
- `npm run dev` — local dev server (first hit on a route compiles on-demand; can be slow, that's dev mode).
- `npm run build` / `npm start` — production build / serve. **Always run `npm run build` after big changes.**
- `npm test` — unit tests (`node --import tsx --test tests/**/*.test.ts`). Keep them green.
- `npx tsc --noEmit` — typecheck. Keep it clean. (If you see stale `.next/types` errors, `rm -rf .next/types`.)
- `npm run db:push` / `db:studio` — Prisma (only if touching the legacy DB).

## Verify before committing (every change)
1. `npx tsc --noEmit` clean, 2. `npm test` green, 3. for UI, sanity-check at desktop AND ~390px mobile.
Commit with clear messages. Git identity used so far: `ThiccLiquidity <travis.w.tanner@gmail.com>`.

## Architecture / data flow
- **Rarity ranks**: MintGarden `openrarity_rank` when present. When absent (common on Chia), we compute our
  own OpenRarity-style ranks in `src/lib/rarity/` (`estimateRank.ts` = information-content scorer;
  `collectionFrequency.ts` = scans the collection, sorts by score → unique 1..N ranks, **versioned** disk
  cache in `.rarity-cache/`). Ranks are scaled to supply where applied so tier percentages are correct.
- **Valuation**: two estimators. Baseline (`src/lib/valuation/estimate.ts`: floor + rarity premium +
  collector-number premium) and the primary comparable-sales model (`comps.ts` + `compsService.ts`: a
  recency-weighted ridge-regression **parabola** fit to recent Dexie sales, × trait-demand × collector).
  **Full spec: `VALUATION-MODEL.md` (current, authoritative). Ignore any older valuation prose.**
- **Caching (the "indexer", Phase 1 done)**: `src/lib/db/nftCache.ts` — `node:sqlite` write-through cache
  (`.cache/traitfolio-cache.db`) for NFT details, collections, sales, XCH rate, slim lists, wallet
  holdings, and comps model inputs. In-memory L1 + DB L2 + network. All guarded (falls back to network if
  SQLite unavailable). **Both `.cache/` and `.rarity-cache/` are per-instance local disk** — Phase 2 is to
  move them to shared storage before scaling horizontally (see LAUNCH-READINESS.md).
- **MintGarden client** (`src/lib/data-sources/mintgarden/client.ts`): global request pacing applies ONLY
  to `background: true` bulk scans; interactive requests (wallet/collection the user waits on) fire freely.
  Separate 429 cooldowns for bg vs interactive. Don't reintroduce global pacing on interactive calls.
- **Binder rendering**: `BinderView` is the shared grid (used by `YourBinder` [wallet], `CollectionBinder`
  [collection page]). Fast path renders immediately from the slim list; `/api/binder` enriches per-NFT
  traits/ranks/values progressively. Filters live in `FilterSidebar` (desktop) + `MobileFilterSheet` (phone).

## Key files map
- `src/lib/valuation/` — estimate.ts, comps.ts, compsService.ts, range.ts (the model).
- `src/lib/rarity/` — estimateRank.ts, collectionFrequency.ts, tiers.ts, enrich.ts (deal score).
- `src/lib/data-sources/mintgarden/` — client.ts, map.ts, owner.ts, types.ts (LIVE data layer).
- `src/lib/market/dexie.ts` — floors, listings, completed sales, XCH rate.
- `src/lib/db/nftCache.ts` — the write-through cache. `src/lib/portfolio/` — holdings aggregation.
- `src/app/` — routes: page (landing), browse, collection/[id], binder, + robots/sitemap/manifest/error/not-found.
- Docs: `ARCHITECTURE.md`, `VALUATION-MODEL.md`, `LAUNCH-READINESS.md`, `WALLET_SETUP.md`.

## Current state (as of this handoff)
- Mobile-hardened, SEO/OG/robots/sitemap/manifest in place, error/404 boundaries, footer disclaimer.
- Repo cleaned: the old mock/seeded-Misfitz demo (~10k images), dead data-source abstraction, and legacy
  DB-backed `/collections/[slug]` pages were removed. Live app is browse/binder/collection + APIs.
- `.env` is gitignored (secrets). `NEXT_PUBLIC_SITE_URL` should be set in prod (OG/robots/sitemap).

## Legacy auth (decision pending — do NOT remove without asking)
NextAuth + `/login`, `/signup`, `/profile`, `/api/wallet/*`, `/api/auth/*`, `/api/signup`, Prisma remain
from before the product went no-login. Nothing in the live nav uses them. In production they need
`NEXTAUTH_SECRET`/`NEXTAUTH_URL`. Options (owner's call): set those secrets, or remove the stack.

## Next up (see LAUNCH-READINESS.md for the full checklist)
Hosting choice (persistent-disk caveat for the caches), set env vars, resolve legacy auth, run a prod
build, legal review of the disclaimer, a branded 1200×630 OG image, and (Phase 2) shared-storage caches.
