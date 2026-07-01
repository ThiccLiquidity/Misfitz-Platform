# Traitfolio Indexer + Database — Scale Plan

**The one-line idea:** stop asking MintGarden for data every time a user needs it. Instead, sync
MintGarden/Dexie data into **our own database** with a background job, and serve every page from our
DB. MintGarden then gets touched only by one quiet background worker — never by a user request.

Today: `user → our server → MintGarden (slow, rate-limited) → user`.
Goal:  `background job → MintGarden (once) → our DB`, and `user → our server → our DB (instant)`.

Why this fixes scale: user-facing speed stops depending on MintGarden entirely. 500 users hit our DB
(fast, unlimited by us). MintGarden only sees the background sync, whose rate WE control.

---

## 1. What we store (database tables)

Prisma models (SQLite now → Postgres later; same schema):

- **Collection** — `id (col1…)`, name, image, banner, totalSupply, verified, creator, `mintgardenRanked`,
  `floorXch`, `volumeXch`, `listingCount`, `lastSyncedAt`.
- **Nft** — `id (hex)`, launcherId, collectionId, name, image, mintNumber, ownerAddress,
  `rarityRank`, `rankSource` (mintgarden | computed), `traits (JSON)`, `lastSyncedAt`.
- **TraitFrequency** — collectionId, traitType, value, count. (Powers rarity ranks + 🔥 trait demand.)
- **Sale** — id, nftId, collectionId, priceXch, soldAt, `cleanXch` (bool). (Powers the value curve.)
- **Listing** — nftId, collectionId, priceXch, offerId, `xchOnly`, active, updatedAt. (Powers floor + deals.)

Everything the site shows today comes from these five tables — no live MintGarden call on the hot path.

## 2. The indexer (background sync jobs)

Scheduled workers (cron-style), each throttled + backing off on rate limits:

- **Collection sync** (daily, or when new mints detected): page a collection's NFTs from MintGarden,
  upsert Nft + traits, recompute TraitFrequency + rarity ranks. This is the heavy job — but it runs in
  the background on a schedule, not while a user waits.
- **Sales sync** (hourly): pull Dexie completed sales *since last sync* (incremental), upsert Sale.
- **Listings/floor sync** (every few minutes): pull Dexie active offers, upsert Listing, recompute floor.
- **Price sync** (every minute): XCH/USD.

Incremental by design: we track `lastSyncedAt` / cursors and only pull the *delta*, so a sync is cheap
after the first full build.

## 3. How the site reads afterward

- **Collection page**: `SELECT * FROM Nft WHERE collectionId=… ORDER BY rarityRank` → instant, ranked,
  tiered, no MintGarden.
- **Comps / value curve**: built from the `Sale` table (already local).
- **Floor / deals**: from `Listing` + `Collection.floorXch` (already local).
- Live MintGarden is only a *fallback* for something not yet synced.

## 4. The binder (your #1 pain) — the big win

The binder is slow today because it fetches **each NFT's full detail** to get traits + rank. With the
DB, the binder only needs the **list of NFT ids an address holds** — one cheap MintGarden call — then
joins that list against our DB for every trait, rank, and value. So:

`paste wallet → 1 lightweight holdings call → DB lookup for the rest → done in ~1s`,

instead of hundreds of per-NFT fetches. This is the single biggest speedup for the collector view.

## 5. Which collections do we index?

We can't pre-index all of Chia (too much). Strategy: **index on demand, then keep warm.**
- First time a collection is viewed → trigger a background sync, store it.
- Popular collections stay indexed + refreshed; obscure ones get indexed on first view (once).
- The DB naturally holds "the collections people actually use," bounded and self-managing.

(This is exactly what the rarity-table disk cache already does — the indexer generalizes it to all data.)

## 6. SQLite → Postgres

- **Now / small scale:** SQLite (file-based, already in the stack) is fine for a single server.
- **At scale / multi-server:** move to hosted Postgres (Supabase, Neon, RDS). With Prisma this is a
  connection-string change, not a rewrite. Do it when you outgrow one server, not before.

## 7. Phased rollout (incremental, low-risk)

- **Phase 1 — Write-through DB cache (biggest bang, least risk).** When we fetch an NFT/collection/sale
  from MintGarden, also write it to the DB, and read from the DB first. Immediately: repeat views and
  the binder read from our DB, not MintGarden. This is basically upgrading today's in-memory/disk cache
  to a real database. *No user-visible behavior change except speed.*
- **Phase 2 — Scheduled refresh jobs.** Add the cron workers so data stays fresh without a user
  triggering it (sales, listings, periodic collection re-sync).
- **Phase 3 — Postgres + hosted deploy.** When you go multi-server.

## 8. Rough effort

- Phase 1: a few focused sessions (schema + write-through + swap reads to DB). The meaningful chunk.
- Phase 2: medium (scheduling infra + incremental sync logic).
- Phase 3: mostly ops/config, not code.

## 9. What changes for you / risks

- **Upside:** user-facing speed becomes independent of MintGarden; 500+ daily users are comfortable;
  the binder gets dramatically faster.
- **Cost:** a database to host (SQLite = free/local; Postgres ≈ $0–25/mo at small scale) and a
  background worker to run. Slightly more moving parts.
- **Data freshness tradeoff:** DB data is as fresh as the last sync (minutes for listings, up to a day
  for deep collection re-scans). For a collector platform that's fine — floors/listings stay near-live,
  and traits/rarity almost never change.
- **Not a rewrite:** Phase 1 slots in behind the existing code; the current live-fetch path stays as
  the fallback, so nothing breaks if a sync is stale.

---

**Bottom line:** the indexer is what turns this from "a nice app that leans on MintGarden" into "a
platform that owns its data." Phase 1 alone removes MintGarden from the hot path for anything we've seen
before — which is most of what 500 daily users would touch.
