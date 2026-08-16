# CLAUDE.md — Traitfolio project handoff

You are the lead software engineer and architect for **Traitfolio**, a Chia NFT **collector-first**
platform. Read this file fully before doing work. It is the single source of truth for how this project
runs and the rules you follow. (Last verified against the code: 2026-07-26 full audit.)

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
any Chia collection. **Next major project: expanding to Robinhood Chain as a first-class peer** — see
"Multi-chain" below before adding anything chain-specific.

## Tech stack
- Next.js **14.2.15** (App Router, TypeScript, most routes `export const dynamic = "force-dynamic"`).
- Tailwind CSS. Theming via CSS vars + a ThemeProvider — see "Theming" below, the live modes are
  `nostalgia` / `nostalgia-night`.
- **No database, no ORM, no auth.** Prisma, NextAuth, `/login`, `/signup`, `/profile`, `/api/auth/*`,
  `/api/wallet/*` were all removed when the product went no-login. Do not reintroduce them.
- Data sources: **MintGarden** API (metadata, traits, ranks), **Dexie** API (listings, sales, floor),
  CoinGecko (XCH→USD, cosmetic only).
- `@upstash/redis` (shared cache), `aws4fetch` (R2 blob backend), `@vercel/functions` (`waitUntil`),
  `@tanstack/react-query`.

## Commands
- `npm run dev` — local dev server (first hit on a route compiles on-demand; can be slow, that's dev mode).
- `npm run build` / `npm start` — production build / serve. **Always run `npm run build` after big changes.**
- `npm test` — unit tests (`node --import tsx --test` over `tests/**/*.test.ts` AND `src/**/__tests__/*.test.mjs`).
- `npx tsc --noEmit` — typecheck. Keep it clean. (If you see stale `.next/types` errors, `rm -rf .next/types`.)
- `npm run bot` — the rewards payout bot CLI (dry-run by default; the rewards system is ON HOLD).
- `npm run backtest` — valuation backtest script.

## Verify before committing (every change)
1. `npx tsc --noEmit` clean, 2. `npm test` green, 3. for UI, sanity-check at desktop AND ~390px mobile.
Commit with clear messages. Git identity used so far: `ThiccLiquidity <travis.w.tanner@gmail.com>`.
**Note for cloud/agent sessions:** `npm test` and `npm run build` cannot run from a Linux sandbox — the
checked-in `node_modules` carry the win32 esbuild binary, so `tsx` throws `TransformError`. `npx tsc --noEmit`
DOES run. Hand test/build runs back to the owner's Windows machine.

## Architecture / data flow
- **Caching is THREE tiers, not one.** Read order in `src/lib/db/nftCache.ts`: in-memory L1 → **Redis
  (Upstash, shared)** → SQLite (`node:sqlite`, local disk, per-instance fallback) → network. Large blobs
  (rosters, value indexes, rarity tables) go through `src/lib/db/blobStore.ts`, a pluggable backend that
  prefers **Cloudflare R2** and falls back to Redis. Every layer is guarded — a cache failure degrades to
  the network, never an error. `/api/cache-health` reports which backend is actually live.
- **Bandwidth is a first-class constraint.** The project blew its Upstash bandwidth limit in July 2026.
  Before adding any cache read on a hot path, read `BANDWIDTH-PLAN.md` and check the per-key byte counters
  in `/api/cache-health`. Large blobs belong on the `cacheGetLarge`/`cachePutLargeAsync` seam (gzip + R2),
  never on plain `cacheGet`/`cachePut`.
- **Rarity ranks**: MintGarden `openrarity_rank` when present. When absent (common on Chia), we compute our
  own OpenRarity-style ranks in `src/lib/rarity/` (`estimateRank.ts` = information-content scorer;
  `collectionFrequency.ts` = scans the collection, sorts by score → unique 1..N ranks, **versioned** disk
  cache in `.rarity-cache/` — still per-instance local disk). Ranks are scaled to supply where applied.
- **Valuation**: two estimators. Baseline (`src/lib/valuation/estimate.ts`: floor + rarity premium +
  collector-number premium) and the primary comparable-sales model (`comps.ts` + `compsService.ts`: a
  recency-weighted ridge-regression **parabola** fit to recent Dexie sales, × trait-demand × collector).
  **Full spec: `VALUATION-MODEL.md` (current, authoritative). Ignore any older valuation prose.**
  XCH amounts round to **6dp** — at 2dp, sub-0.01 floors quantized to zero and wrote 0 into the value index.
- **Value index** (`src/lib/valuation/valueIndex.ts`): the per-collection `vidx:` blob that makes the binder
  and the collection page show the SAME number for an NFT. `/api/values` reads it for the binder's poll.
- **MintGarden client** (`src/lib/data-sources/mintgarden/client.ts`): global request pacing applies ONLY
  to `background: true` bulk scans; interactive requests (wallet/collection the user waits on) fire freely.
  Separate 429 cooldowns for bg vs interactive. Don't reintroduce global pacing on interactive calls.
  Caveat: this state is module-level, so it is per-instance — the effective global rate scales with Vercel
  instance count.
- **Binder rendering**: `BinderView` is the shared grid (used by `YourBinder` [wallet], `CollectionBinder`
  [collection page]). Fast path renders immediately from the slim list; `/api/binder` enriches per-NFT
  traits/ranks/values progressively; `/api/holdings/page` pages a wallet's roster with the BROWSER driving
  the cursor. Filters live in `FilterSidebar` (desktop) + `MobileFilterSheet` (phone).
- **Seed overlay** (`src/lib/data-sources/seed/`): a committed, pre-built JSON snapshot for known
  collections (currently Misfitz), dynamically imported and stamped over live cards by `overlay.ts`. Gated
  by `TRAITFOLIO_SEED=1`. Built by `scripts/build-seed.ts`.
- **Untrusted input** goes through `src/lib/chia/ids.ts` (`isCollectionId` / `isNftId` / `isSaneAmount`)
  before any upstream call. A bare `startsWith("col1")` is NOT enough — it let junk ids trigger real scans.

## Key files map
- `src/lib/valuation/` — estimate.ts, comps.ts, compsService.ts, range.ts, valueIndex.ts, valueEntry.ts.
- `src/lib/rarity/` — estimateRank.ts, collectionFrequency.ts, tiers.ts, enrich.ts (deal score).
- `src/lib/data-sources/mintgarden/` — client.ts, map.ts, owner.ts, types.ts (LIVE data layer).
- `src/lib/market/dexie.ts` — floors, listings, completed sales, XCH rate. `floorTrust.ts` — floor sanitizing.
- `src/lib/db/nftCache.ts` + `blobStore.ts` — the cache. `src/lib/portfolio/` — holdings aggregation.
- `src/lib/chia/` — bech32.ts (address decode), ids.ts (untrusted-input validators).
- `src/lib/tang/` + `src/components/tang/` — Tang Gang "peel points" partner integration, gated by
  `NEXT_PUBLIC_TANG_GANG`. `tangData.ts` is a hand-carried snapshot of the partner's data; it needs
  re-syncing from them and the peel-point unit is still TBD.
- `src/lib/rewards/` (~50 files) — the $SNACKZ token / rewards / airdrop system. **ON HOLD, do not delete,
  do not build on it.** Shadow-only, hard-blocked from sending. Several files are `npx tsx` CLI entry points
  with zero inbound imports — an automated dead-code tool will flag them and be WRONG.
- `src/app/` — routes: page (landing), browse, collection/[id], binder, + robots/sitemap/manifest/error/404.
  Dev-only, gated: `/theme-lab` (`ENABLE_THEME_LAB`), `/comps-status`, `/api/nft-debug`, `/api/rewards/dev-compute`.
  Secret-gated: `/api/warm` + `/api/rewards/cron` (`CRON_SECRET`), `/api/rewards/*` operator routes
  (`REWARDS_OPS_SECRET`). **Still unauthenticated: `/api/status`, `/api/cache-health`, `/api/seed-health`.**
- Docs: `AUDIT-2026-07.md` (current findings + open decisions), `VALUATION-MODEL.md`, `BANDWIDTH-PLAN.md`,
  `LAUNCH-READINESS.md` (STALE — its auth/Prisma blockers are long resolved), `ARCHITECTURE.md` (STALE — a
  pre-build proposal describing a Postgres/Prisma/NextAuth app that was never shipped; read for design
  rationale only), `MISFITZ-REWARDS.md` + `BOT-CONTRACT.md` (the on-hold rewards system).

## Theming
`ThemeProvider` normalizes every stored value to **`nostalgia`** or **`nostalgia-night`** — those are the
only two modes that can exist at runtime. `light`/`dark` remain in the `ThemeMode` union, in ~16 components'
`mode === "light"` branches, and in ~200 CSS rule blocks, but **none of it is reachable.** Don't "fix" a
light-mode bug; ask whether light/dark are coming back first.

## Environment variables (the ones the code actually reads)
`KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) — Redis. `R2_ACCOUNT_ID` / `R2_BUCKET` /
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — all four required or the R2 backend silently stays off.
`NEXT_PUBLIC_SITE_URL` (OG/robots/sitemap), `CRON_SECRET`, `REWARDS_SHADOW`, `REWARDS_OPS_SECRET`,
`REWARDS_LAUNCH`, `TRAITFOLIO_SEED`, `NEXT_PUBLIC_TANG_GANG`, `ENABLE_THEME_LAB`, `VALUATION_COMPS_ENABLED`,
`TRAITFOLIO_ADAPTIVE_HALFLIFE`, `MINTGARDEN_API_BASE`. `.env` is gitignored. `DATABASE_URL` /
`NEXTAUTH_SECRET` / `NEXTAUTH_URL` are DEAD — nothing reads them.

## Multi-chain (Robinhood Chain) — read before adding chain-specific code
The codebase is **wide but shallowly** coupled to Chia. `comps.ts` and the rarity scorers are already
currency- and chain-agnostic; `NftData` is already the neutral domain type. The expensive coupling is:
(1) **cache keys have no chain dimension** — `holdings3:0xabc…` would collide across EVM chains and silently
serve the wrong NFTs, with every layer guarded so it never surfaces as an error; (2) `startsWith("col1")`
appears ~33 times across 11 files as an implicit "is this a real collection" predicate; (3) `xchUsdRate` is
threaded through ~15 signatures. **Every one of those gets more expensive the longer Chia-only code grows.**
Do not revive the deleted `DataSource` interface (`git show 2dda90a^:src/lib/data-sources/types.ts`) — its
4-method shape cannot express cursor paging, background pacing, batched reads, or checkpoint/resume, which
is why it was removed. Define any chain interface from the real call sites. Full plan in `AUDIT-2026-07.md`.

## Current state
- Mobile-hardened, SEO/OG/robots/sitemap/manifest in place, error/404 boundaries, footer disclaimer.
- Live app is browse/binder/collection + APIs. Legacy auth stack fully removed. Share-to-X removed
  (collectors save the SOLD card image and post it themselves).
- A full audit ran 2026-07-26; safe fixes are applied and the open decisions are in `AUDIT-2026-07.md`.

## Diagnose before building (standing owner rule)

Do NOT write code for a production symptom until a diagnostic has NAMED the failure. Run the
URL, report the measurement, then fix. This rule was set after four confidently-wrong fixes in
a row, two of which made the site slower.

Secret for `?key=` (OPS_SECRET / REWARDS_OPS_SECRET / CRON_SECRET all work):
`wd8COkTa00e-9aeUxbkIOhGq04vlOQ4ENMJ6JkRuNK4`

| What | URL |
|---|---|
| Per-collection cache state — run this FIRST for any "slow / missing cards / rebuilding" report | `/api/diag/collection/<col1...>?key=<secret>&probe=1` |
| Redis + blob health, Upstash bytes by prefix | `/api/cache-health?key=<secret>&fresh=1` |
| Build/runtime status | `/api/status?key=<secret>` |

Misfitz (usual repro): `col1s8fwfqdl3x77h7rn40m0mzhkgp7kajdwu56me36glv0ez8w79heqst90mh`

`&probe=1` round-trips a real ~1.5MB blob through the live backend; `&bytes=2500000` hunts for
a size cliff. An agent cannot fetch these itself (robots.txt blocks /api/, and the device shell
has no network) — ask the owner to paste the JSON.

**Instrument at the real size.** `/api/cache-health` wrote an 8-byte probe and stayed green for
a month while R2 rejected every real payload with 411. Eight bytes prove credentials parsed and
nothing else. Likewise, a write helper returning `void` is where a silent failure lives:
`putBlob` returned void, so a 403 on every write was indistinguishable from success.
