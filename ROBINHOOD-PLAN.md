# Robinhood Chain — full chain support

Goal: a complete, usable Traitfolio for **all** Robinhood Chain NFT users, the same way it works for Chia.
Supersedes the OpenSea-adapter plan (rejected — ~25 chains means an unbounded collection universe) and the
single-seeded-collection plan (rejected — the owner wants the whole chain, not one project).

---

## Correcting the earlier "this is a dud" call

That judgement was about **EVM at large**: Ethereum has hundreds of thousands of NFT collections, our
architecture must ingest a whole collection to compute a rarity rank, and no amount of caching survives that.

**Robinhood Chain is not that.** Measured 2026-07-26 against its public Blockscout API:

- The ERC-721 universe is on the order of **50–200 collections**, not hundreds of thousands. Many are
  10,000-supply PFP sets — Robinhood Bears, Robinhood Pixels, Robinfoxes, Hood Raccoons, URSAPE, PEPEHOOD,
  DORIAN PEPENTICE, RoboHoods, MechVoid, Openpoop, Robinhood Distorted, /dev/daemons.
- Some ERC-721s are **utility, not collectibles** — Uniswap V3 Positions (491,339 supply), Robinhood Gift
  (16.5k). These must be filtered out or they poison discovery and the rarity model.

**Robinhood Chain is smaller than Chia.** Full-chain support is not only affordable, it is *cheaper per
collection than Chia already is* — for one specific reason below.

---

## Why this is cheaper per collection than Chia

On Chia, `listCollectionNfts` does not reliably carry traits, so we fetch **per-NFT details** — the single
largest Redis consumer we have (34,439 cached details ≈ 83 MB, and it was ~5× worse before the audit).

Blockscout's `/api/v2/tokens/{addr}/instances` returns **`metadata.attributes` inline** — verified. One
paginated scan yields the entire collection with traits, images and token ids.

**That removes the per-NFT detail cache entirely for this chain.** Roster, traits and ranks become one blob
per collection on R2 (zero egress). No `tf:d:*`, no detail MGETs, no detail storage.

### Indexing the whole chain, costed

| | |
|---|---|
| Collections (real, after filtering utility NFTs) | ~100 |
| Avg supply | ~10,000 |
| Instances per request | 50 |
| Requests per collection | ~200 |
| **Requests for a full chain index** | **~20,000** |
| Blockscout limit with a free API key | 10 req/s |
| **Wall-clock for a full index** | **~35 minutes**, once, then incremental |

Storage: ~1 MB gzipped roster per collection → **~100 MB on R2 ≈ $0.002/month.** Rarity tables add ~30 MB.
Bandwidth is R2 egress, which is free.

**Marginal cost of the whole chain: cents per month.** The constraint is wall-clock during the first index,
not money.

---

## What we can and cannot get

| Need | Source | Status |
|---|---|---|
| Collection discovery | `GET /api/v2/tokens?type=ERC-721` | ✅ verified working |
| Roster + traits + images | `GET /api/v2/tokens/{addr}/instances` | ✅ verified — `metadata.attributes` inline |
| Rarity ranks | our own `estimateRank.ts` | ✅ chain-agnostic already, zero changes |
| Wallet holdings | `GET /api/v2/addresses/{addr}/nft` | standard endpoint |
| Transfers | `GET /api/v2/tokens/{addr}/transfers` | available, **but carries no price** |
| Floor / listings / **sales** | ❌ no aggregator exists | **the real problem — see below** |

Rate limits: **3 req/s anonymous, 10 req/s with a free key, 25 req/s whitelisted.** Get a key before Phase 3;
it triples throughput for nothing.

---

## The one hard problem: prices

Chia has Dexie — one API, all listings and completed sales. **Robinhood Chain has no equivalent.** OpenSea
supports the chain in its UI but does *not* expose it in the API (`robinhood` is not an accepted `chain`
value). Prices exist only inside individual marketplace contracts.

That means reconstructing market data from **marketplace contract events**, per marketplace:
- Identify each marketplace contract trading RHC NFTs.
- Require it to be **verified** on Blockscout so its ABI is public and its events decodable.
- Decode listing / sale events via the logs endpoint; a cron writes one small blob per collection to R2.

**Risks, stated plainly:** marketplaces are fragmented and new ones appear; an unverified contract is opaque;
and volume is thin enough that the comps model may not have enough sales to fit a curve, in which case
collections fall back to floor-only. This phase is the least predictable part of the project and it is where
the schedule will slip.

**Degraded mode is still a product.** Without prices we ship the whole chain browsable by rarity, with ranks,
tiers, traits and wallet holdings — but no values, no deal scores. That is worth shipping while prices are
solved.

---

## What this requires that the seeded approach didn't

Full-chain support **is** the multi-chain refactor. It cannot be avoided:

**Phase 0 · Foundations — 1 day.** `ChainId` / `CollectionRef` / `AssetRef` / `OwnerRef`; chain-namespace every
cache key so a chainless key is a compile error; replace the 33 `startsWith("col1")` predicates.
⚠️ Renames every cache key → full re-warm. **Do it while Upstash is healthy, not before.**
⚠️ Non-negotiable for correctness: an EOA has the **same `0x…` address on every EVM chain**, and every cache
layer is catch-guarded, so an unnamespaced key serves wrong NFTs with no error path.

**Phase 1 · Routing + currency — 1–1.5 days.** `/collection/[chain]/[id]` + 301 resolver (SEO exposure is
near-zero today; that window closes on your first marketing push). `floorXch` → `floorNative`, `formatXch(v)`
→ `formatNative(v, currency)`.

**Phase 2 · ChainAdapter — 1.5–2 days.** Defined from real call sites, not a whiteboard. `ChiaAdapter` wraps
existing MintGarden+Dexie unchanged. Pacing/cooldown state moves per-adapter so one chain's rate limit cannot
stall the other. **Do not revive the deleted `DataSource` interface** (`git show 2dda90a^:src/lib/data-sources/types.ts`).

**Phase 3 · BlockscoutAdapter — 1.5–2 weeks.** Discovery with a utility-NFT filter; bulk roster+traits scan
with checkpoint/resume on the existing rails; ownership; ERC-165 detection to **skip ERC-1155** (semi-fungible
breaks rank uniqueness). Rarity and comps need no changes — `comps.ts` fits `{rank, price}` with no currency
assumptions.

**Phase 4 · Prices — 1–2 weeks, high variance.** As above.

**Phase 5 · Cross-chain surface — 1–2 weeks.** Binder accepts mixed `xch1` / `did:chia` / `0x`. Chain filters,
badges, sitemap, copy sweep (~24 files say "Chia").
❗ **Product decision owed:** cross-chain totals must become **USD** — summing XCH and ETH is meaningless.
Per-NFT and per-collection values stay native. This changes the binder's headline number.

**Total ≈ 5–7 weeks.**

---

## Rules that keep the cost near zero

1. **Never fetch per-NFT details on this chain.** The bulk instances endpoint makes them unnecessary — that
   discipline is the whole cost advantage. If it is broken, RHC becomes as expensive as Chia.
2. **Every RHC blob goes to R2, nothing to Redis.**
3. **Filter utility NFTs at discovery.** Uniswap position NFTs alone are 491k tokens; indexing them would be
   pure waste and would corrupt rarity.
4. **Cap the indexed set** — top N collections by holder count, expanded deliberately. The chain is four weeks
   old; if it grows 100× the economics must be re-checked, not assumed.
5. **Get a free Blockscout API key** (3 → 10 req/s) before the first full index.
6. **Move Upstash to pay-as-you-go first.** Storage, not bandwidth, is the binding constraint, and the 250 MB
   Fixed plan will not survive a second chain.

---

## Honest risk list

- **Single point of failure.** Chia has MintGarden *and* Dexie. RHC would have Blockscout for everything, on a
  free public instance. If it rate-limits or goes down, the chain goes dark. Worth pricing their PRO API.
- **Prices may not be solvable cleanly**, and thin volume may starve the comps model regardless.
- **The chain is four weeks old.** Collection count could grow 10–100×, which changes the indexing budget.
- **Competition arrives with scale.** Today RHC is underserved, which is the opportunity. That is also exactly
  why it will not stay underserved.
