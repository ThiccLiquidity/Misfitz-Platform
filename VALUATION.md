# Valuation & Ranking Spec

The canonical model for how this platform **ranks** NFTs within a collection and **estimates their
value**. Locked through design review. Code in `src/lib/rarity`, `src/lib/valuation`, and the
market layer (`src/lib/market`) implements this; when code and this doc disagree, this doc wins
until amended.

## Guiding principles

1. **Accuracy with honesty.** The Chia NFT market is thin. The enemy is *false precision* — a
   confident single number on an NFT that hasn't traded in months. We prefer a bounded range +
   confidence over a fake-exact figure.
2. **Never a mystery number.** Every estimate is shown as labeled components a person can read and
   argue with. No black boxes.
3. **Consistency builds trust.** People cross-check their NFTs on MintGarden and Dexie. Where a
   standard exists, we match it rather than invent.
4. **Rarity ≠ desirability.** Statistical rarity and what the community actually *wants* are
   different signals. We compute them separately and never let one quietly distort the other.

---

## Part 1 — Rarity ranking

### Method: OpenRarity (information content)

We rank by **OpenRarity**, the industry standard (the same method MintGarden's `openrarity_rank`
uses). Intuition: measure how *surprising* each trait is, in bits, and add up the surprise.

For an NFT, for each trait category `a` with the NFT's value `v`:

```
p(a = v)  = count(v within category a) / N          # N = collection supply
IC(a = v) = -log2( p(a = v) )                         # information content, in bits
rarityScore(NFT) = Σ over all categories a of IC(a = v)
```

NFTs are ranked by **descending `rarityScore`** (ties broken by ascending mint number for
determinism). Rank → percentile (`rank / N`) → the visual rarity tiers already in
`src/lib/rarity/tiers.ts` (Common → Mythic). Normalizing the score by collection entropy does not
change the order, so we skip it for ranking.

### Source of truth

- **Use MintGarden's `openrarity_rank` directly whenever present.** This guarantees our rank agrees
  with what collectors see elsewhere.
- **Compute OpenRarity identically only when forced** (e.g., a collection we index ourselves before
  it's on MintGarden, such as Misfitz pre-listing). Same formula → same numbers.

### Rules that keep ranking correct

- **Missing traits count.** If some NFTs lack a category, "(none)" is a real value with its own
  count and IC. "No hat" can be rarer than any hat.
- **Exclude degenerate traits.** Any category whose distinct-value count is ~equal to supply
  (`distinctValues / N ≥ 0.5`) is an identifier (serial number, image hash), not a trait — e.g.
  Chia Gods' "Image Coin". Excluded from ranking *and* from displayed trait rarity and value math.
- **Trait-count meta-trait: OFF by default.** "Number of traits" is not a factor unless a specific
  collection opts in (per-collection toggle), to stay aligned with standard OpenRarity.

---

## Part 2 — Special / collectible numbers

A separate layer from rarity. Special mint numbers are about **desirability, not rarity**, so they
**never change the OpenRarity rank**. They produce (a) a **badge** (generous — recognition is free)
and (b) a **value bump** (tiered and disciplined — only grails meaningfully move price).

The number is the NFT's mint/edition number: MintGarden `series_number`, falling back to parsing
`#<n>` from the name; no number → no badge.

### Tiers (badge prestige + value weight)

| Tier | Examples | Value weight |
| --- | --- | --- |
| **1 — Grail** | #1 "Genesis", #N "Finale" (last mint), #69 "Nice", #420 "Blaze", #1337 "Leet", 4-digit repdigits #1111–#9999 (#7777 "Jackpot", #8888 "Lucky 8s") | high |
| **2 — Legendary** | single digits #2–#9, 3-digit repdigits #111–#999, #42 "The Answer", #666 "Beast", #777, #888, #1234/#4321 "Straight", milestones #1000/#10000, long palindromes #1221/#1331/#12321 "Mirror" | medium |
| **3 — Rare** | 2-digit repdigits #11–#99, #100, round thousands, angel numbers #1010/#1212, #007 "Bond", #404 "Not Found", #13, #8/#88, sequentials #123/#321, 3-digit palindromes, powers of two #256/#512/#1024/#2048 | small |
| **4 — Fun** | low mints #10–#99 "Early Mint", round hundreds, ABAB/AABB patterns, smaller powers of two, jersey numbers #21/#23/#24 | badge only (~0) |

### Mechanics

- **Size-aware:** a rule only applies if the collection is large enough (no #7777 grail in a
  500-piece set).
- **Highest tier wins:** an NFT matching several categories (e.g. #777 is repdigit + lucky + angel)
  takes the best tier, shows the best label, gets one bump — no stacking.
- **Per-collection slot:** an artist can anoint one custom number (its own lore/lucky number).
- Implemented as one configurable, pure ruleset (testable in isolation).

---

## Part 3 — Fair value equation

### Shape of the answer

A **bounded range + confidence chip**, not a bare number:

```
≈ 2.4 XCH   ·   range 2.0 – 2.9 XCH   ·   confidence: medium
```

Built from labeled components:

```
estimate = robustFloor
         + rarityPremium
         + desirabilityPremium        # special numbers (Part 2)
         + traitDemandPremium         # heat + reputation (below)
estimate = reality-check(estimate, ownListing, recentComps)
output   = point + cappedRange + confidence
```

### Components

**Robust floor (the anchor — ~most of the value).**
Median of the `K` cheapest active asks (default `K = 5`) from Dexie, in XCH. Using a median, not the
single lowest ask, stops one troll/fat-finger listing from moving everyone's value. Fewer than `K`
asks → use what exists; **zero asks → no floor → no point estimate** (show "insufficient market
data", low confidence).

**Rarity premium (single signal — no double-count).**
`rarityPremium = robustFloor × R(percentile)` where `R` is a multiplier curve that's ~0 near the
median and rises steeply for the top few %. Default curve (tunable):

| Rank percentile | top 1% | top 5% | top 10% | top 25% | top 50% | rest |
| --- | --- | --- | --- | --- | --- | --- |
| `R` (× floor) | 4.0 | 2.0 | 1.0 | 0.4 | 0.15 | 0.05 |

When a collection has enough listings spanning ranks, **calibrate `R` to the observed
price-vs-rank spread**; otherwise use the default. There is **no separate static trait premium** —
OpenRarity rank already encodes trait rarity, so a standalone trait-rarity premium would double-count
and overprice rare NFTs.

**Desirability premium (special numbers).**
`desirabilityPremium = robustFloor × weight(tier)` (Part 2), capped. Grails ~0.3–0.5× floor,
legendary ~0.1×, rare ~0.03×, fun ~0.

**Trait demand premium (dynamic — two layers).**
This is the piece that makes value track the market as traits get hot. It is *demand*, not rarity.

- *Heat (transient).* From recent sales: for each sale within the window, the **residual** =
  `salePrice − (robustFloor + rarityPremium + desirabilityPremium)`. Residuals are attributed to the
  sold NFT's traits and **recency-weighted** with a **2-week half-life** over a **30-day window**
  (`weight = 0.5 ^ (ageDays / 14)`). A trait registers heat only with **≥ 3 qualifying sales** in
  the window (one lucky sale can't invent demand). Multi-trait attribution in v1 is a per-trait
  recency-weighted residual average; the rigorous upgrade is a hedonic regression (planned).
- *Reputation (durable).* Each time a trait spikes into "hot" and cools, it banks reputation. After
  **2–3 distinct heat episodes** a trait earns a standing premium floor that decays on a **~6-month
  half-life** — sticky, "community favorite", but not immortal if the trait truly dies. Earns a
  **"Community Favorite" badge**.
- *Combine:* `traitDemand(t) = reputation(t) + max(0, heat(t) − reputation(t))`. A fluke spikes then
  fades to ~0; a blue-chip trait holds its earned floor and spikes above it when hot. The whole
  trait-demand line is **capped** (≤ ~0.5× floor) so even a beloved trait can't break believability.

**Reality check.**
If the NFT is **currently listed**, surface that ask alongside the estimate (hard information). If
**recent comparable sales** exist (same collection, similar rank), pull the estimate toward them.
Real data beats our curves.

### Range & confidence

- **Confidence** ∈ {low, medium, high}, driven by data density: number of active listings, number
  and recency of comparable sales.
- **Range width scales inversely with confidence and is capped:** roughly ±8% (high), ±18% (med),
  ±28% (low) — never a huge band. The confidence chip, not an ugly wide range, carries uncertainty.

---

## Part 4 — Data requirements & rollout

**Works today** (no new data pipeline):
- OpenRarity rank (from MintGarden, or computed) and rarity tiers.
- Special-number badges + desirability bump.
- Robust floor + rarity premium → a basic estimate + confidence from listing density.

**Needs the sales-history feed** (warms up over time):
- Trait **heat** and **reputation**, recent-comp reality checks, calibrated rarity curve.
- Requires ingesting **completed sales**: Dexie completed offers (`status = 4`) + MintGarden NFT
  sale `events`, into a small rolling per-collection store, recomputed on a schedule (the schema's
  `SyncLog` + a new `Sale`/sales table). It cannot show heat on a collection's day one — reputation
  in particular only forms after several observed cycles. That's the honest, intended behavior:
  **the platform gets smarter the longer it runs.**

### Schema mapping (FairValueEstimate)

The existing nullable component slots were left for exactly this. Target mapping (small migration to
split trait demand + add desirability):

| Concept | Field |
| --- | --- |
| robust floor | `floorValue` |
| rarity premium | `rarityPremium` |
| special-number desirability | `desirabilityPremium` *(add)* |
| trait heat | `demandPremium` |
| trait reputation | `traitReputationPremium` *(add)* — or `traitPremium`, repurposed |
| (reserved) historical sales, CAT rewards | `historicalSalesPremium`, `rewardValue` |

---

## Part 5 — Tuning parameters (defaults)

| Parameter | Default | Notes |
| --- | --- | --- |
| Robust floor sample `K` | 5 cheapest asks | median of these |
| Rarity curve `R` | table above | calibrate to listings when available |
| Desirability weights | grail .3–.5 / legend .1 / rare .03 / fun 0 | × floor, capped |
| Heat half-life | 14 days | recency weighting |
| Heat window | 30 days | sales considered |
| Min sales for heat | 3 | per trait, in window |
| Reputation onset | 2–3 episodes | before a standing floor forms |
| Reputation half-life | ~6 months | sticky, not immortal |
| Trait-demand cap | ≤ 0.5 × floor | total line |
| Range width | ±8 / ±18 / ±28% (high/med/low) | capped |

All knobs live in config so they can be tuned per collection without code changes.
