# Robinhood Chain — one collection, near-zero data cost

Supersedes `EXPANSION-PLAN.md` (which proposed an OpenSea adapter across ~25 chains — rejected: our
scan-and-cache architecture cannot survive an EVM-sized collection universe). This is the narrow version:
**support specific collections we choose, not a chain.**

---

## Why this one is cheap when the other was not

The expensive part of Traitfolio is **discovery**: scanning a whole collection to compute rarity, because a
rank is only knowable with the full trait table in hand. That is what drives the 30–70s cold scan, the roster
blobs, the detail cache, and the Upstash bill.

A **seeded** collection skips all of it. `scripts/build-seed.ts` already computes OpenRarity ranks offline and
commits the result as one JSON — Misfitz runs on it today, 10,000 entries. For a seeded collection there is:

- **no runtime scan** — the roster is a build-time artifact
- **no per-NFT detail cache** (`tf:d:*` is the single largest Redis consumer for Chia — 83 MB — and a seeded
  collection uses none of it)
- **no rarity table blob, no roster blob, no scan checkpoint**
- **no third-party API on the render path**

The seed ships inside the Vercel bundle. **Marginal data cost of adding a collection this way is effectively
zero.** The only live data is market state, and that is one small cached blob per collection, refreshed by
cron — not per view and not per NFT.

---

## What we can get without asking anyone (verified 2026-07-26)

Robinhood Chain runs a public **Blockscout** explorer with a free API. Confirmed working against a live
collection:

| Need | Source | Verified |
|---|---|---|
| Collection list / supply / holders | `GET /api/v2/tokens?type=ERC-721` | ✅ returns data |
| Roster + **traits** + images | `GET /api/v2/tokens/{addr}/instances` | ✅ returns `metadata.attributes` as `{trait_type,value}` |
| Ownership for a wallet | `GET /api/v2/addresses/{addr}/nft` | standard endpoint |
| Transfers | `GET /api/v2/tokens/{addr}/transfers` | standard endpoint |
| **Sale prices** | ❌ not in transfers | must come from the marketplace contract's events |

`metadata.attributes` is **the same shape `build-seed.ts` already parses**, so the existing rank pipeline works
with almost no change.

---

## The one real gap: prices

A transfer event carries no price — it cannot distinguish a 0.1 ETH sale from a gift. Real prices live in the
marketplace contract's own events.

- **If that contract is verified on Blockscout**, its ABI is public and we decode listings + completed sales
  straight from chain logs. No API, no scraping, no dependency on anyone's site staying up.
- **If it is unverified**, we can still detect *that* a sale happened, but not for how much. The collection
  then ships rank/tier/traits only — no floor, no deal score, no comps.

**Fallback if prices prove unreachable:** ship the collection rank-and-trait only. That is still the core of
the product, and prices can be added later without rework.

---

## Build plan

**A · Seed the collection — ~1 day**
Extend `scripts/build-seed.ts` with an EVM input mode: page `/instances` from Blockscout, map
`metadata.attributes` → traits, keep the existing information-content rank computation untouched. Drop the
`colId.startsWith("col1")` guard. Output `src/lib/data-sources/seed/<chain>-<contract>.json` + a registry entry.
*Deliverable: full roster, traits, images and our ranks, as a committed file.*

**B · Render a non-Chia collection — ~1–2 days**
The collection page currently gates on `isCollectionId()` (Chia bech32). Widen it to **also accept an id
present in the seed registry** — explicitly a registry lookup, not a loosened regex, so the abuse surface
closed in the audit stays closed. Seeded collections already bypass MintGarden, so this is a narrow change,
not the multi-chain refactor.
*Deliverable: their collection browsable by rarity at a Traitfolio URL.*

**C · Wallet lookup — ~1 day**
Accept a `0x…` address, call Blockscout's address-NFT endpoint filtered to the contract, intersect with the
seed. One small request per wallet, memoised.
*Deliverable: "paste your address, see your holdings" for that collection.*

**D · Prices — ~1–3 days, gated on the marketplace contract**
Identify the marketplace contract, confirm it is verified, decode its listing/sale events via Blockscout's
logs endpoint. A cron writes **one small blob per collection** to R2 (floor, active listings, recent sales).
Feed sales into the existing comps model — which needs no changes, since `comps.ts` fits `{rank, price}` and
has no currency assumptions.
*Deliverable: floors, values, deal scores.*

**Total: 3–5 days** for A–C, plus 1–3 for prices.

---

## Cost model

| Line | Cost |
|---|---|
| Seed file (roster, traits, ranks, ~10k items) | **$0** — in the repo/bundle |
| Rarity computation | **$0** — offline, once, at build time |
| Collection page render | **$0** extra — served from the seed |
| Ownership lookups | one free Blockscout call per wallet, memoised |
| Market blob | one small R2 object per collection, cron-refreshed |
| **Marginal monthly cost** | **≈ $0** |

Contrast with the rejected approach, where each new chain meant indexing an unbounded collection universe
through a rate-limited API.

---

## Rules that keep it cheap

1. **Seeded collections only.** A hard registry, one entry per collection we choose. No open-ended chain
   discovery, ever. This is the rule that makes every other number hold.
2. **Nothing new in Redis.** Market blobs go to R2 (zero egress). Seeded collections must never populate
   `tf:d:*`.
3. **Poll per collection, never per NFT.** One cron, one blob. Rendering must not trigger upstream calls.
4. **Images: prefer IPFS/HTTP URLs over embedded data URIs.** Some Robinhood collections are fully on-chain
   with base64 SVG in the metadata — 10,000 of those would make the seed file enormous. If their project is
   fully on-chain we store a reference and fetch on demand instead of embedding.

---

## What I need to start

1. **The collection's contract address** (or its name — I can find the address on Blockscout).
2. **The marketplace URL**, only so I can identify which contract it trades through and check whether that
   contract is verified. Public chain data; nothing needed from its owner.

Then A–C can be built and reviewed locally before anything ships.
