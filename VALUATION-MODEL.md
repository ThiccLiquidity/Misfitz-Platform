# Traitfolio Valuation Model — Current Spec (for review)

> Self-contained description of how Traitfolio estimates the value of a Chia NFT, written from the
> live code (not the older `VALUATION.md`, which predates the parabola + comparable-sales rewrite and
> is stale). Intended as a hand-off for external review. Every constant below is the actual value in code.

---

## 0. Philosophy

Collector-first, **explainable**, and **floor-anchored**. An NFT is never valued from thin air: its
estimate starts at the collection floor and is adjusted by (a) how rare it is and (b) what the market is
actually paying, with recent real sales shaping the curve. We prefer to under-claim than to invent a price,
and we surface *why* a number is what it is.

Two estimators exist. When a collection has enough recent clean sales we use the **comparable-sales model**
(primary); otherwise we fall back to the **baseline estimator**. Both share the same rarity + floor inputs.

---

## 1. Inputs & data sources

- **MintGarden** (`api.mintgarden.io`): NFT metadata, traits (CHIP-0007 attributes), collection supply,
  and `openrarity_rank` when MintGarden has ranked the collection. Also `attributes_frequency_counts`.
- **Dexie** (`api.dexie.space`): active listings (status 0) → floor; completed sales (status 4) → the comps
  evidence. We keep only **single-NFT, XCH-only** offers (a bundle or an XCH+CAT offer is not a clean per-NFT price).
- **CoinGecko**: XCH→USD, cosmetic only (USD labels). XCH figures never depend on it.

All of the above are cached (in-memory + a persistent write-through cache) so steady-state cost is ~zero.

---

## 2. Rarity rank

Rarity is expressed as a **rank** (1 = rarest) and a **percentile** = rank / supply.

### 2a. Collections MintGarden has ranked
Use MintGarden's `openrarity_rank` directly.

### 2b. Collections MintGarden has NOT ranked (common on Chia)
We compute our own OpenRarity-style rank:
1. Page the whole collection, tally a trait-frequency table (per trait_type → value → count).
2. For each NFT, score = sum over its traits of the **information content** IC = −log2(count / N), where N is
   the number of ranked NFTs. (Higher score = rarer. Identity-like categories — usernames, wallets, serials,
   and very high-cardinality fields — are dropped so they don't dominate.)
3. **Rank by sorting** all NFTs by score descending and assigning sequential ranks 1..M (M = NFTs we could
   rank). Sorting matters: a percentile estimate ties many NFTs at the same rank, which corrupts tier counts.
4. **Scale to supply** when applied: displayRank = round(((r − 0.5) / M) × supply). This makes rank/supply a
   true percentile even when M < supply (big collections, traitless NFTs, fetch gaps), so tier bands get their
   correct share. Result is persisted so the expensive scan happens ~once per collection.

---

### 2c. NFTs we cannot rank (traitless, or metadata fetch gaps)
Some NFTs carry no usable traits (empty attributes) or fail to fetch. They get **no rank**, and by design
their estimate falls back to the **floor**: the baseline estimator maps a null rank to the 50th-percentile
rarity factor (= 0), so estimate = floor + any collector-number premium, and the comps model returns null
for a null rank. Intentional — with no rarity signal we make no rarity claim and anchor at the collection
floor rather than guess. The UI marks these unranked (the tier bar shows a "not yet scored by the rarity
index" count; the NFT card notes a floor estimate).

## 3. Tiers

Cumulative percentile thresholds (rank/supply×100 ≤ threshold):

| Tier | ≤ percentile | band width |
| --- | --- | --- |
| Mythic | 0.1% | 0.10% |
| Legendary | 0.5% | 0.40% |
| Epic | 2.5% | 2.00% |
| Rare | 10% | 7.50% |
| Uncommon | 30% | 20.00% |
| Common | 100% | 70.00% |

---

## 4. Baseline estimator (fallback — no/low sales)

    estimate = floor + rarityPremium + collectorPremium

- **floor**: robust floor = median of the cheapest 5 active XCH-only asks (a single troll listing can't move it).
  Precedence for the collection floor: live Dexie ask → MintGarden floor → recent Dexie sale floor → cheapest
  signal among held NFTs. No floor ⇒ **no estimate** (we show "—", never a fake 0).
- **rarityPremium** = floor × R(percentile), where R is a smooth, monotonic curve through these anchors,
  log-interpolated between them (no steps at tier edges):

  | percentile | R (× floor) |
  | --- | --- |
  | 0.1% | 14.0 |
  | 0.5% | 7.0 |
  | 2.5% | 2.0 |
  | 10% | 0.8 |
  | 30% | 0.2 |
  | ≥50% | 0.0 (commons sit at floor) |

- **collectorPremium** = floor × desirabilityWeight, a small bump for "special" token numbers
  (e.g. 69, 420, 777, #1, palindromes, digit runs), weight ∈ [0,1] from a tiered ruleset. 0 if not special.

Note: there is deliberately **no** standalone trait-rarity premium — OpenRarity rank already encodes trait
rarity, so adding one would double-count.

---

## 5. Comparable-sales model (primary — when recent clean sales exist)

The value curve is **always a smooth rarity parabola in rarity-space**:

    curveValue(rank) = a + b·rf + c·rf²     where rf = R(percentile(rank))   (rf high for rare, 0 for common)

Because rf is itself a curved function of rank, this is a smooth parabola in rank. The three coefficients
(a, b, c) are **fit to recent sales** by recency-weighted least squares with a **ridge prior** pulling toward
the floor-anchored baseline (a≈floor, b≈floor, c≈0):

- Recency weight per sale: w = 0.5^(ageDays / halfLife), **halfLife = 120 days**.
- Ridge strength **λ = 0.7** toward prior [floor, floor, 0] (≈ that many "virtual" baseline sales).
- Solve the 3×3 normal equations (Gaussian elimination). **b, c are clamped ≥ 0** so the curve is monotonic
  (rarer ≥ less-rare); an off-curve cheap sale becomes a *deal*, never a dent in the curve.
- Result: sales "pull and tug" the whole parabola (a cluster of strong rare sales steepens it; mid sales lift
  it), but sparse/noisy data stays near the baseline. It always resolves to one clean parabola — no waves.

For unranked collections, the comps model uses **our own ranks** (Section 2b, scaled to supply) in place of
MintGarden's, and our own trait table — so unranked collections get the full curve too.

### 5a. Trait-demand multiplier (applied on top, multiplicatively)
Traits selling **more often recently than their prevalence** run hot:
- For each trait value: expectedShare = freq/supply; observedShare = recency-weighted share of recent sales
  (**demand half-life = 21 days**). ratio = observedShare / expectedShare.
- Only ratio > 1 adds. Contribution = log(ratio) × **demandDamp (0.16)** × reliability, reliability = n/(n+8),
  requiring **≥ 3** sales of that trait to count. Combined multiplier = clamp(exp(Σ), 1, **1.6**).
- Collection-wide "trending traits" (the 🔥 chips) surface any trait with ratio > **1.15**.

### 5a-note. Design decision — trait demand is PREMIUM-ONLY (intentional)

Trait demand can only ADD to value; it never discounts. This is deliberate, not an oversight:
- A trait "cooling off" is already expressed two ways without a discount term: (1) the rarity **curve
  refits downward** as recent sale prices fall, and (2) trait heat **decays automatically** as older
  sales age out of the 21-day demand window (the recency weight `wd` shrinks, so observedShare drops
  back toward prevalence and the multiplier relaxes to 1.0).
- Letting demand go below 1.0 would double-count weakness (the curve already dropped) and could push an
  NFT below a floor-anchored value it can still realistically fetch. Premium-only keeps the floor as an
  honest lower bound and the model easy to explain to collectors.

### 5b. Final blend

    estimate = max( floor, curveValue × traitDemandMult × collectorMult )

where collectorMult = 1 + (collector-number weight). So the market curve replaces floor+rarity; trait demand
and collector number are multiplicative bumps; the floor is a hard lower bound.

### 5c. Confidence — design decision: a DISPLAY signal, not a point-estimate modulator
`supportAt(rank)` measures LOCAL sales support: a Gaussian kernel over the ranks of recent sales
(bandwidth = max(supply×0.01, 100)), squashed to [0, 0.92] — "how many real sales sit near this rarity,
recently?"

It is deliberately **not** multiplied into the point estimate. The estimate is already regularized
*globally* by the ridge prior (thin/quiet collections stay near the floor-anchored baseline because the
fit cannot overcome the prior). Folding confidence in on top would double-regularize and systematically
undervalue well-supported NFTs. Instead confidence is surfaced as a per-NFT **confidence indicator** so
collectors can see how sales-backed an estimate is. If a future version wants a visible uncertainty band,
derive it from this confidence — do not bake it into the point estimate.

---

## 6. Deal score (for listings)

For an NFT with a clean XCH-only ask:

    discount = 1 − ask / estimate            (>0 = below our estimate)
    score    = clamp( round(50 + discount × 120), 0, 100 )

| score | label | shown as |
| --- | --- | --- |
| ≥ 80 | GREAT DEAL | "Send it 🚀" |
| ≥ 60 | GOOD DEAL | "Cop it 🤝" |
| ≥ 40 | FAIR DEAL | "Fair play ⚖️" |
| < 40 | OVERPRICED | "Champagne taste 🥂" |

Paying exactly our estimate scores 50 (fair). No deal score is shown for XCH+CAT or bundle offers (the price
isn't a clean per-NFT XCH figure).

---

## 7. Portfolio / collection aggregates
- **Floor value** = Σ each NFT's collection floor. **Traitfolio value** = Σ each NFT's estimate.
- **Market cap** = floor × supply. **Traitfolio cap** = Σ estimates across the collection.

---

## 8. Known limitations / open questions for reviewers
1. **Rarity model** is OpenRarity-style information content assuming trait independence. Is IC the right basis
   vs. e.g. trait-normalized or statistical rarity? Should meta "trait count" be included?
2. **Rarity premium anchors** (Section 4 table) are hand-calibrated. Are the multiples (14× at 0.1%, etc.)
   reasonable across collections of different sizes/liquidity?
3. **Comps ridge prior (λ=0.7)** and **half-lives (120d price / 21d demand)** are judgment calls. (Hardened:
   the curvature term c now gets a 6× heavier ridge, and sale prices are winsorized to [p5,p95] before the
   fit. We kept λ self-scaling via the recency-weight sum rather than forcing λ(n), which would gut thin data.)
4. **Monotonic clamp (b,c ≥ 0)**: we forbid the curve from ever valuing a rarer NFT below a less-rare one.
   Correct, or are there collections where that's genuinely wrong?
5. **Trait demand** uses recent sale *volume* vs prevalence, capped at 1.6×. (Hardened: each trait's
   observed/expected ratio is now capped at 6× and requires ≥4 distinct-NFT sales, limiting rare-trait
   double-count and wash-trade leverage.) Open: should price, not just volume, inform demand?
6. **Floor precedence** and the "cheapest signal among holdings" fallback — sound, or does it bias small wallets?
7. **Cold-start**: collections with few sales lean on the baseline. Is the baseline a good prior, or should
   thin-data collections show wider ranges / lower confidence more aggressively?
