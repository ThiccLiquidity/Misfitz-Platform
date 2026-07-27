# Multi-chain expansion — revised plan (OpenSea adapter first)

Supersedes the multi-chain section of `AUDIT-2026-07.md`. Written 2026-07-26 after researching what
Robinhood Chain actually offers.

---

## The reframe

The original goal was "expand to Robinhood Chain." Research changed the shape of that:

- **Robinhood Chain mainnet went live 1 July 2026.** It is a permissionless, EVM-compatible Arbitrum L2.
  Robinhood's own docs cover tokenised equities/ETFs — NFTs are not part of their product. NFTs exist there
  only because the chain is permissionless.
- **OpenSea added Robinhood Chain on 11 July 2026**, NFTs and tokens, live trading.
- **~26 NFT collections exist there today.** OnChainHoodies 0.033 ETH floor / ~14.7 ETH daily volume,
  Gremlin Cartel 0.031 ETH, Cash Cats ~6 ETH daily. Small, volatile, but genuinely trading.
- **The OpenSea API v2 does NOT yet accept `robinhood` as a `chain` value.** Documented values are
  blast, base, ethereum, zora, arbitrum, sei, avalanche, polygon, optimism, ape_chain, flow, b3, soneium,
  ronin, bera_chain, solana, shape, unichain, gunzilla, abstract, animechain, hyperevm, somnia, monad,
  hyperliquid. The marketplace supports the chain; the programmable interface does not.

**Therefore: build the OpenSea adapter, not a Robinhood adapter.** Identical engineering effort, and instead
of one four-week-old chain it lands us on ~25 — with Robinhood arriving as a flag flip when OpenSea adds it
to the API.

---

## Why OpenSea is a better fit than it first appears

It replaces **both** of our Chia data sources with one integration:

| What Traitfolio needs | Chia today | OpenSea equivalent |
|---|---|---|
| Collection metadata | MintGarden | `GET /collections/{slug}` |
| NFT list for a collection | MintGarden paging | `GET /collection/{slug}/nfts` |
| NFT detail + traits | MintGarden | `GET /chain/{chain}/contract/{addr}/nfts/{id}` |
| A wallet's NFTs | MintGarden address/profile | `GET /chain/{chain}/account/{addr}/nfts` |
| Floor + volume stats | Dexie | `GET /collections/{slug}/stats` |
| Active listings | Dexie offers | `GET /listings/collection/{slug}/all` |
| **Completed sales** | Dexie completed offers | `GET /events/collection/{slug}?event_type=sale` |

That last row is the one that matters. **The comps model needs a completed-sales feed**; without it a chain
ships floor-only and the product's core differentiator is degraded. OpenSea provides it. This was the single
biggest risk in the original plan and it is largely retired.

Auth: an API key is required (`x-api-key`), with an instant free-tier key. **Rate limits are not publicly
documented** — "reach out for higher throughput." Treat the limit as the primary unknown.

---

## What already works in our favour

From the audit's coupling analysis — none of this needs rewriting:

- **`comps.ts` (374 lines) has zero currency assumptions.** It fits a curve to `{rank, price}`. Feed it ETH
  sales and it works unmodified.
- **Rarity is chain-free.** `estimateRank.ts`, `openrarity.ts`, `tiers.ts`, `collectibleNumbers.ts` take trait
  tables. ERC-721 metadata tallies identically to CHIP-0007.
- **`NftData` is already the neutral domain type** every component consumes.
- **The binder is already a multi-identity aggregator** — several ids, one binder. "Several ids across several
  chains" is the same model with a wider id type.
- **The checkpoint/resume + background-pacing machinery** built for large Chia wallets is exactly what an
  OpenSea rate limit will require.

---

## Phases

**Phase 0 · Multi-chain foundations — 1 day. Do this first, and before more Chia-only code lands.**
`ChainId`/`CollectionRef`/`AssetRef`/`OwnerRef` types; chain-namespace every cache key so a chainless key is a
compile error; replace the 33 `startsWith("col1")` predicates with `chainOf()` / `isLiveRef()`.
*Ships: identical Chia-only app. Pure refactor.*
⚠️ **Wait until Upstash is healthy** — renaming keys orphans every cached blob and forces a full re-warm.

**Phase 1 · Routing + currency vocabulary — 1–1.5 days**
`/collection/[chain]/[id]` with a 301 resolver (SEO exposure is near-zero today — `sitemap.ts` lists only 3
static URLs — and that window closes on your first marketing push). Rename `floorXch`→`floorNative`,
`xchUsdRate`→`nativeUsdRate`. `formatXch(v)` → `formatNative(v, currency)`.
*Ships: identical Chia-only app with multi-chain-shaped URLs.*

**Phase 2 · ChainAdapter extraction — 1.5–2 days**
Define the interface **from the real call sites**, not from a whiteboard. `ChiaAdapter` wraps the existing
MintGarden + Dexie code unchanged. Move pacing/cooldown state from module-global into the adapter instance so
one chain's rate limit can't stall another.
*Ships: identical Chia-only app, one adapter registered.*
❗ Do **not** revive the deleted `DataSource` interface (`git show 2dda90a^:src/lib/data-sources/types.ts`).
Its 4-method shape can't express cursor paging, background pacing, batched reads or checkpoint/resume.

**Phase 3 · OpenSeaAdapter — 2–3 weeks**
One adapter serving N chains. Metadata, ownership, listings, stats, and the sales feed; `evm/map.ts` →
`NftData`; ERC-165 detection to **skip ERC-1155** (semi-fungible breaks rank uniqueness and one-card-one-NFT —
scope to ERC-721); per-chain rate limiting on the existing pacing rails.
*Ships: the first EVM chain, flag-gated.*

**Phase 4 · Cross-chain product surface — 1–2 weeks**
Binder accepts mixed `xch1` / `did:chia` / `0x` ids. Chain filters and badges on `/browse`. Chain-aware
sitemap. UI copy sweep (~24 files say "Chia").
❗ **Product decision required:** cross-chain totals must become **USD**, because summing XCH and ETH is
meaningless. Per-NFT and per-collection values stay in native units. This changes the binder's headline number
and makes USD load-bearing where it is currently explicitly cosmetic.

**Total ≈ 6–8 weeks** — but delivering ~25 chains rather than one.

---

## Which chain to launch with

**Recommendation: launch Phase 3 on Base or Ethereum, not Robinhood.**

Both are fully supported by the API today, have deep NFT liquidity and years of sales history for the comps
model to fit against — so we validate the adapter where the data is richest. Robinhood Chain then becomes a
one-line registry entry the day OpenSea exposes it, with zero additional engineering.

Launching on Robinhood first means blocking on an API gap outside our control, and calibrating a valuation
model against a market that is four weeks old.

---

## Data budget

Adding chains does **not** multiply the data bill — cost scales with *collections × viewers*, not chains.
Modelled on measured cache sizes:

- Redis traffic per cold binder view is now **~2.5 MB** (was 16.6 MB) since comps/sales joined the other large
  blobs on R2, which has zero egress.
- Projected **~9.4 GB/month** against a 200 GB pay-as-you-go allowance.
- Estimated total infrastructure: **~$0.62/month** for two chains (commands dominate at $0.20/100K).

**The binding constraint is Redis storage, not bandwidth** — per-NFT details are the one large thing still in
Redis. 25 collections at 5,000 NFTs adds ~300 MB, which is fatal on a 250 MB Fixed plan and trivial on
pay-as-you-go's 100 GB.

**Four rules:**
1. Move Upstash to pay-as-you-go **before** adding a chain. Removes the hard cutoff, 250 MB → 100 GB storage.
2. Every non-Chia blob goes to R2 from day one. The backend already supports it; it's a code discipline.
3. Chain-namespace cache keys (Phase 0) — required for correctness regardless: an EOA has the **same `0x…`
   address on every EVM chain**, so an unnamespaced key silently serves the wrong NFTs, and every cache layer
   is catch-guarded so it never surfaces as an error.
4. Per-chain warm-set quota, and enable chains **one at a time behind flags** — 25 available chains must not
   mean 25 chains being indexed.

---

## Open questions

1. **OpenSea rate limits** — undocumented. Get a free key and measure before committing to Phase 3 scope.
   This is the top unknown and it directly sets how long a collection scan takes.
2. **Does `robinhood` work as an undocumented `chain` value?** The docs list may lag the product. Worth one
   curl once we have a key.
3. **Royalties** — EIP-2981 is advisory and widely bypassed, so observed sale prices vary by venue. Consume
   gross price, record venue per sale, document as a known cross-chain incomparability.
4. **ERC-1155** — out of scope. Detect and skip with a clear "not yet supported" state.
5. Whether to keep MintGarden/Dexie for Chia (yes — OpenSea does not support Chia) or unify later (no).
