# Chia NFT Collector Platform — Architecture Proposal

Scope confirmed before this draft: web app only, multi-user platform (real accounts), MintGarden as the
recommended live data source (added after a mock-data phase). Misfitz is the first collection; nothing
below should require a rewrite to add a second.

## Product Vision

Not a marketplace — the best collector experience on Chia. The reference feel is "Pokémon cards invented
in 2026 for NFT collectors": opening a binder, discovering a rare pull, organizing a collection, hunting
undervalued NFTs, showing off a binder to friends. Collectors first, marketplace second. The platform must
stay enjoyable to browse even for someone who never buys or sells.

Confirmed pillars beyond the original 10-point architecture, layered onto the same plugin/adapter
foundation so none of it is Misfitz-specific:

- **The Binder** — the core browsing surface, not a generic grid. Spec validated via an interactive
  prototype, see §11.
- **Fair Value Estimator** — every NFT gets an explainable estimate (floor + rarity premium + trait
  premium, later sales/demand/reward premiums), never a mystery number.
- **Profiles, levels, badges, leaderboards** — collector identity is separate from wallet ownership (see
  §5/§6). Badges are permanent earned events; collector levels are permanent once reached (confirmed —
  selling down does not demote a collector).
- **Deal Finder** — filter/sort over the same NFT data (best deals, undervalued, trait/background search),
  no new architecture beyond the existing data model.
- **Future marketplace/rewards** — offer creation, offer visibility across the Chia ecosystem, and CAT
  token rewards are explicitly deferred; the data model below reserves room for them without committing
  to them yet.

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js 14+ (App Router), React, TypeScript | Server components for fast NFT grid pages, file-based routing, one deploy target with the API. |
| Styling/UI | Tailwind CSS + shadcn/ui | Fast, consistent, unopinionated enough to support per-collection theming. |
| Data fetching (client) | TanStack Query | Caching, refetch, pagination for NFT grids without hand-rolled state. |
| Backend | Next.js Route Handlers (API routes) | No second service to deploy/operate for v1; same TypeScript types end-to-end. |
| Database | PostgreSQL | Relational fit for users/collections/NFTs/ownership; JSON columns handle variable trait schemas. |
| ORM | Prisma | Type-safe queries, migrations, good fit for the plugin-style schema below. |
| Auth | Auth.js (NextAuth) | Email/password + OAuth out of the box; wallet linking handled as a separate step (see §5/§6). |
| Caching | Redis (Upstash) | Cache MintGarden responses; avoid hammering a third-party API with no published rate limit. |
| Background sync | Vercel Cron (or a small worker) | Periodic pull of collection/NFT data from the active data source into Postgres. |
| Hosting | Vercel (app) + managed Postgres (Neon or Supabase) | Low ops burden, scales to zero, fits a solo-maintained collector platform. |
| Images | Next/Image against source CDN URLs | Avoid re-hosting NFT images; cache headers handle the rest. |

This is a single deployable app, not a microservice sprawl — appropriate for the current scale, and Next.js
route handlers can be peeled into standalone services later if a sync worker ever needs to run independently.

## 2. Folder Structure

```
/app
  /(marketing)/              # public landing, no auth
  /(app)/                    # authenticated shell
    /collections/[slug]/     # generic collection page — works for any collection
    /nft/[launcherId]/       # generic NFT detail page
    /profile/
  /api/
    /collections/[slug]/
    /nft/[launcherId]/
    /sync/                   # cron-triggered data source sync
/components
  /ui/                       # shadcn primitives
  /collection/                # CollectionHeader, CollectionGrid, CollectionStats
  /nft/                       # NftCard, TraitsList, RarityBadge, OwnershipPanel
  /wallet/                    # WalletLinkButton, WalletPanel
/lib
  /collections/                # plugin registry — one entry per collection, see §8
    registry.ts
    misfitz.ts
  /data-sources/                # adapter pattern, see §7
    types.ts                  # DataSource interface
    mock/
    mintgarden/
  /db/                        # Prisma client, query helpers
  /auth/
/prisma
  schema.prisma
/types
```

The rule enforced by this layout: nothing under `/components` or `/app/(app)/collections` and
`/app/(app)/nft` may import anything Misfitz-specific. Collection-specific data lives only in
`/lib/collections/*` and the database.

## 3. Database Schema

```
User
  id, email, passwordHash, createdAt

Wallet
  id, userId (FK), address, verifiedAt, label
  -- a user can link multiple Chia addresses; verification described in §6

Collection
  id, slug, name, description, bannerUrl, iconUrl
  chainCollectionId        -- the on-chain/MintGarden collection identifier
  dataSourceKey            -- "mock" | "mintgarden" | future adapters
  themeConfig (json)       -- accent color, logo, optional per-collection display tweaks
  traitSchema (json)       -- optional hint for how to render this collection's traits
  createdAt

Nft
  id, collectionId (FK), launcherId (unique, on-chain coin id)
  name, imageUrl, metadata (json), traits (json), rarityRank
  currentOwnerAddress, lastSyncedAt

FairValueEstimate
  id, nftId (FK)
  floorValue, rarityPremium, traitPremium       -- v1 components
  historicalSalesPremium, demandPremium, rewardValue   -- nullable, future components
  totalEstimate, estimatedAt
  -- stored as discrete fields, not just a final number, so the UI can always show the breakdown
  -- ("never a mystery number"). Recomputed on sync, never silently overwritten without a new row
  -- if we later want a history of how an estimate moved over time.

UserWatchlist
  id, userId (FK), nftId (FK), createdAt

UserCollectionFollow
  id, userId (FK), collectionId (FK), createdAt

Profile
  id, userId (FK, unique), username, avatarUrl, bio
  collectorLevel            -- highest level ever reached; see note below
  createdAt

Badge
  id, key, name, description, iconUrl
  -- static catalog, like CollectionPlugin entries — defining a new badge is a registration, not a migration

UserBadge
  id, userId (FK), badgeId (FK), earnedAt, earnedReason
  -- append-only. A badge row is never deleted or recomputed away — permanence is enforced by only ever
  -- inserting, never running a "does this user still qualify" sweep that removes rows.

SyncLog
  id, collectionId (FK), source, startedAt, finishedAt, status, errorMessage
```

`Profile.collectorLevel` stores the highest level ever reached, not a live computation from current
holdings — matches the confirmed rule that levels are permanent, like badges. The level-up logic still
evaluates current holdings against level thresholds, but it only ever raises this stored value, never
lowers it.

`metadata`/`traits`/`themeConfig` are JSON precisely because every Chia collection defines its own trait
keys and branding — forcing them into fixed columns is what causes "major rewrite per collection." The
fixed columns (`name`, `imageUrl`, `rarityRank`, `currentOwnerAddress`) are the fields every NFT card/detail
view actually needs to render generically.

## 4. Component Hierarchy

```
AppShell
 ├─ NavBar (account menu, wallet status, ThemeToggle)
 └─ page content
     CollectionPage
      ├─ CollectionHeader (banner, name, stats — theme-driven, not collection-coded)
      ├─ CollectionStats (count, floor if available, followers)
      └─ BinderView                          -- replaces a generic grid, see §11 for the validated spec
          ├─ BinderPage (3x3 grid of NftCard, one of two stacked pages)
          │   └─ NftCard (art, name, rarity rank, fair value estimate) → opens NftDetailModal
          └─ BinderPageControls (prev/next, swipe, page indicator)

     NftDetailModal                          -- center-open over a blurred BinderView, not a separate route
      ├─ NftHero (image, name, collection link)
      ├─ TraitsList (renders Nft.traits generically)
      ├─ RarityBadge
      ├─ FairValueBreakdown (renders FairValueEstimate fields, never just the total)
      ├─ OwnershipPanel (current owner, "is this you? link your wallet")
      └─ ActivityHistory (mint/sale events — stretch, depends on data source)

     ProfilePage
      ├─ ProfileHeader (username, avatar, collector level badge)
      ├─ BadgeShelf (renders UserBadge rows — permanent, append-only)
      ├─ WalletLinkButton / linked wallets list
      ├─ WatchlistGrid (reuses NftCard in a grid, not a binder)
      └─ FollowedCollections (reuses CollectionHeader in compact form)
```

Every component above takes plain `Collection`/`Nft`/`Profile` props from `/types` — none import a
collection slug or branch on "is this Misfitz." `BinderView`/`BinderPage` read collection theming
(`Collection.themeConfig`) for accent color and card chrome, but the flip mechanics, grid layout, and
modal behavior are identical for every collection — see §11.

## 5. Authentication Approach

Two distinct concerns, kept separate:

- **Account auth** (who is logged in): Auth.js with email/password and optionally Google OAuth. Standard
  session handling, password reset, etc. This has nothing to do with Chia wallets — it's just how a user
  accesses their profile, watchlist, and followed collections.
- **Wallet linking** (proving you own an address): a separate, optional step described in §6. A user can
  fully use the platform (browse collections, build a watchlist) without ever linking a wallet.

This separation matters because Chia wallet signing UX is still immature compared to account auth — coupling
them would make login fragile.

## 6. Wallet Integration Strategy

Phased, matching the "mock before live" instruction:

- **Phase 1 (mock):** user pastes a Chia address into their profile, no signature check. The platform treats
  it as "view this address's NFTs" — useful for demos and for browsing before real verification exists.
- **Phase 2 (verified):** wallet linking via challenge-response — the platform generates a nonce, the user
  signs it with a Chia wallet that supports message signing (Sage Wallet is the current standard for this),
  and the backend verifies the signature against the claimed address before marking `Wallet.verifiedAt`.
- **No custody, no transactions:** this is a collector/viewing platform, not a marketplace — the app never
  requests a wallet connection for signing transactions, only for proving address ownership. That keeps the
  security surface small and avoids building offer/trade flows that aren't part of the product vision.

## 7. Mock Data Strategy

A `DataSource` interface is the seam between "mock" and "live," so swapping one out is a config change, not a
rewrite:

```ts
interface DataSource {
  getCollection(chainCollectionId: string): Promise<CollectionData>
  listNfts(chainCollectionId: string, page: number): Promise<NftData[]>
  getNft(launcherId: string): Promise<NftData>
  getNftsByOwner(address: string): Promise<NftData[]>
}
```

- `MockDataSource` reads from JSON fixtures shaped **exactly** like MintGarden's actual API responses
  (confirmed via research — see §9), so the eventual `MintGardenDataSource` is a thin HTTP-calling
  implementation of the same interface, not a redesign.
- A seed script loads the mock fixtures into Postgres for local/dev use, so the rest of the app always reads
  from the database — it never knows whether the data originated from mock JSON or a live sync job.
- `Collection.dataSourceKey` picks the adapter per collection, so Misfitz could run on mock data while a
  future collection runs live, simultaneously, with no code branching in the UI layer.

## 8. Collection Plugin Strategy

Adding a collection is a registration, not a feature build:

```ts
// /lib/collections/misfitz.ts
export const misfitz: CollectionPlugin = {
  slug: "misfitz",
  chainCollectionId: "<on-chain collection id>",
  dataSourceKey: "mock",          // flips to "mintgarden" later
  theme: { accent: "#...", logoUrl: "/collections/misfitz/logo.png" },
}
```

Each entry is registered in `/lib/collections/registry.ts` and mirrored as a `Collection` row in Postgres
(the registry seeds the DB row; the DB row is what the running app actually queries). Static registry +
DB row is intentional redundancy: the registry is source-controlled and reviewable, the DB row is what
supports runtime features like follower counts without redeploying.

## 9. How Future Collections Plug In Without Major Rewrites

This is the load-bearing requirement, so it's addressed by four specific decisions made above, not by a
separate mechanism:

- **Generic domain model with JSON escape hatches** (§3): trait keys, themes, and metadata vary per
  collection and live in JSON columns, so the schema never needs a migration to support a new collection's
  shape.
- **Adapter pattern for data sources** (§7): if a future collection isn't on MintGarden, only a new
  `DataSource` implementation is needed — the rest of the app is unaffected.
- **Collection-agnostic components** (§4): `NftCard`, `CollectionGrid`, etc. render from data and theme
  config, never from hardcoded collection logic.
- **Plugin registry** (§8): onboarding a collection is adding one config object and one DB row.

Net effect: adding collection #2 should touch exactly `/lib/collections/<new>.ts` plus a database insert —
zero changes inside `/components`, `/app`, or the Prisma schema.

## 10. Recommended Data Source (research finding)

Researched MintGarden, SpaceScan, Dexie, and a self-hosted full node as options for the eventual live
integration:

- **MintGarden** is the recommended primary source: free, public, unauthenticated REST API with collection,
  NFT, owner, and OpenRarity rarity-rank endpoints — the closest thing Chia has to a standard NFT indexer.
  One open item: a live check didn't find "Misfitz" indexed under that exact name, so the collection's
  launcher/collection ID needs to be confirmed before live integration begins.
- **SpaceScan** is a reasonable fallback/cross-check (alpha-stage API, no rarity field).
- **Dexie** isn't suited as the metadata backbone (no collection/trait endpoints) but is worth layering in
  later for floor-price/market-activity widgets, if that's ever in scope for a collector-first (not
  trading-first) product.
- **Self-hosting a full node** is not recommended for v1 — it would mean rebuilding what MintGarden already
  indexes, with real infrastructure cost. Worth revisiting only for live ownership verification at the
  individual-NFT level later, as a light targeted check rather than full indexing.

This is reflected in the schema/adapter design above (`dataSourceKey: "mintgarden"`) but live integration
itself is explicitly out of scope for milestone 1 below.

## 11. The Binder & Card System (UX Spec)

This is the centerpiece of the product, so it was validated interactively (HTML/CSS/JS prototype, four
iterations) before committing it to the real component tree. Confirmed spec, to be ported into the
`BinderView`/`BinderPage`/`NftCard`/`NftDetailModal` components in §4:

- **Page density:** 9 cards per page, 3x3 grid — matches a real binder page, dense enough to feel like a
  collection without crowding.
- **Card proportions:** `aspect-ratio: 5/7`, approximating real trading-card stock (2.5"×3.5"), not a
  square NFT thumbnail. Art fills the upper area, name/rank/fair-value sit in a fixed-height footer.
- **Page turn:** a real 3D page flip — the current page rotates on a hinge (`rotateY`, hinge edge
  determined by flip direction) and the *next* page is visible underneath as it turns, not a crossfade or
  instant swap. Tuned to a slower, deliberate ~0.7s with an ease curve so it reads as a physical flip,
  not a UI transition. Implementation note: every wrapper element between the `perspective`-holding
  container and the rotating page must have `transform-style: preserve-3d`, or the rotation flattens —
  this was a real bug during prototyping and is worth a code comment when ported.
- **Card open:** tapping a card brings it front-and-center, enlarged, over the binder page, with the
  binder page behind it blurred — not a separate page navigation. Closing returns it to its slot.
- **Theme:** two modes, both collection-themeable via `Collection.themeConfig`, not hardcoded to Misfitz:
  - *Dark (default):* fully immersive "vault" feel — deep leather/wood tones, gold/brass trim, subtle
    glow on card borders. Confirmed as the stronger default over a subtler dark mode.
  - *Light:* bright, paper/binder-page feel, same layout and motion, swapped palette only.
- **Input:** click/tap on page controls and swipe gesture both trigger the same flip, same animation.

None of the above references Misfitz-specific assets — the prototype used placeholder art and Misfitz's
real images/metadata (still pending from the user) drop in without changing any of this component logic.

## First Implementation Milestone

**Goal:** a working, mock-data-only Misfitz *binder* experience that proves both the plugin architecture
and the validated UX spec in §11, with real account auth — no live data, no wallet verification, no fair
value/badges/leaderboards yet.

In scope:
- Next.js app scaffold, Prisma schema, Postgres (SQLite for local dev) migrations for the tables in §3.
- `MockDataSource` + Misfitz fixture data shaped like MintGarden's real response format (placeholder art
  until the real Misfitz dataset is supplied).
- Seed script populating the dev database.
- Real `BinderView`/`BinderPage`/`NftCard`/`NftDetailModal` components, ported from the validated
  prototype (§11), built entirely generically — no Misfitz-specific logic inside them.
- Misfitz collection page using those components, plus the dark/light theme toggle.
- Account auth (sign up, log in, log out) via Auth.js.
- Profile page shell (no watchlist/wallet/badges functionality required yet, but the route exists).

Explicitly deferred to later milestones:
- Live MintGarden integration (pending confirmation of Misfitz's collection ID).
- Wallet linking/verification.
- Fair Value Estimator real computation (UI slot exists in `NftDetailModal`, values mocked for now).
- Badges, collector levels, leaderboards.
- Watchlists and collection-follow features.
- Deal Finder filter/sort UI.
- Any market/offer data (Dexie) or future CAT token rewards.
- A second collection (used later purely to validate the plugin claim in §9, not part of milestone 1).

---

Flagging one thing for your review: the MintGarden lookup for "Misfitz" came back empty in research, so
before we commit to MintGarden as the live source we should confirm the collection's actual on-chain/
MintGarden collection ID. Happy to dig into that, or you can point me to it directly if you already have it.
