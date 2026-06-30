# Traitfolio — NFT Value Estimate: Technical Formula Breakdown

This is the exact, current valuation pipeline (parameters included) for a Chia NFT.
Purpose: share with reviewers to critique/refine. Notation: `floor` = collection floor in XCH.

---

## Pipeline at a glance

```
baseEstimate = floor + rarityPremium + desirabilityPremium        (our "formula")
compsValue   = rankCurve(rank) × traitFactor                      (from real sales)
effConf      = confidence²                                        (thin data pulls far less)
compsValue   = min(compsValue, baseEstimate × (effConf<0.5 ? 3 : 5))   (comps pull cap)
final        = effConf × compsValue + (1 − effConf) × baseEstimate
final        = max(final, floor)                                  (never below floor)
```

`final` is the displayed **Est. Value**. The breakdown UI shows `baseEstimate` as line items,
then a single **“Sales comps” adjustment** = `final − baseEstimate`.

---

## Stage 1 — Robust floor (the anchor)

```
floor = median( k cheapest CLEAN XCH active asks ),  k = 5
```
- “Clean” = single‑NFT, XCH‑only offer (CAT‑bundled offers excluded).
- Sources: Dexie + MintGarden native listings. Median (not min) so one troll listing can’t move it.
- Zero clean asks ⇒ no estimate shown (not a fake 0).

## Stage 2 — Base estimate (formula only, pre‑sales)

```
percentile        = rank / totalSupply              (lower = rarer)
rarityPremium     = floor × R(percentile)
desirabilityPremium = floor × clamp(specialNumberWeight, 0, 1)
baseEstimate      = floor + rarityPremium + desirabilityPremium
```

Rarity multiplier `R(percentile)` — **tunable, current values:**

| percentile | ≤0.1% | ≤0.5% | ≤2.5% | ≤10% | ≤30% | rest |
|---|---|---|---|---|---|---|
| tier | mythic | legendary | epic | rare | uncommon | common |
| **R (× floor)** | **14** | **7** | **2.0** | **0.8** | **0.2** | **0** |

Special‑number weight (collector appeal), capped, only if the mint # is special:
grail ≈ 0.4 · legendary ≈ 0.1 · rare ≈ 0.03 · fun ≈ 0 (× floor).

Rank itself = OpenRarity (MintGarden official rank where present, else our matching OpenRarity estimator).

## Stage 3 — Comparable‑sales value (from real clean‑XCH sales)

Built per collection from completed clean‑XCH sales, each tagged with the sold NFT’s rank + traits.
Recency weight on every sale: `w = 0.5 ^ (ageDays / 120)`  (120‑day half‑life).

**3a. Rank→price curve** — value implied by rarity position (recency × rank‑distance decay):
```
bandwidth          = max(totalSupply × 0.01, 100)
rankDistanceWeight = exp( −|saleRank − rank| / bandwidth )
weight             = recencyWeight × rankDistanceWeight
rankCurve(rank)    = weighted median sale price over ALL sales (far/old sales fade smoothly)
```

**3b. Per‑trait stats** (n = clean‑XCH sales carrying trait t, n ≥ 3):
```
mult(t)        = recency‑weighted median of ( salePrice / rankCurve(saleRank) )   # raw multiplier
reliability(t) = n / (n + 12)                                                     # thin data counts less
# rank‑correlation penalty: damp traits that mostly ride on already‑rare NFTs
traitMedianPct = median rank‑percentile of sold NFTs carrying t
penalty(t)     = 0.5 if traitMedianPct < 0.10 ; 0.75 if < 0.25 ; else 1.0
```

**3c. Compose in LOG space (not multiplicative), then clamp tighter:**
```
traitLogScore = Σ  log(mult(t)) × reliability(t) × penalty(t)
traitFactor   = clamp( exp(traitLogScore), 0.6, 3.0 )     # <-- was [0.4, 5]
compsValue    = rankCurve(rank) × traitFactor
```
Log‑space + reliability + penalty stop a few thin/correlated trait sales from compounding the high end.

**3d. Confidence** (how much nearby sales back this NFT):
```
conf = clamp( Σ [ w · (1 − dist/100) ]  for sales with dist=|saleRank − rank| ≤ 100 , over 6 ,  0..1 )
```
~6 weighted nearby recent sales ⇒ full confidence.

## Stage 4 — Blend

```
effConf    = confidence²                                   # 0.52 -> 0.27
cap        = baseEstimate × (effConf < 0.5 ? 3 : 5)
compsValue = min(compsValue, cap)                          # comps can't run away from base
final      = effConf × compsValue + (1 − effConf) × baseEstimate
final      = max(final, floor)
```

---

## Tunable parameters (current defaults)

| Param | Value | Where | Effect |
|---|---|---|---|
| Floor sample `k` | 5 | floor | robustness vs responsiveness |
| Rarity curve `R` | 14/7/2/0.8/0.2/0 | base | how much rarity is worth |
| Rank‑curve neighbours `K` | 25 | comps | smoothness of rank→price |
| Recency half‑life | 120 days | comps | how fast old sales fade |
| Rank‑distance bandwidth | max(supply×0.01, 100) | comps | how far in rank a sale informs |
| Trait reliability constant | 12 | comps | n/(n+12) — how fast a trait premium counts |
| Rank‑correlation penalty | 0.5 / 0.75 / 1.0 | comps | damps rarity‑correlated traits |
| Min sales per trait | 3 | comps | noise floor for trait premiums |
| **Trait factor clamp** | **[0.6, 3.0]** | comps | caps combined trait multiplier (log‑space) |
| Confidence | **squared** before blend | blend | thin data pulls far less |
| **Comps pull cap** | **base × 3 (or ×5)** | blend | comps can't run away from the formula |
| Confidence normaliser | 6 | comps | sales needed for full confidence |

---

## Worked example (real card: rank #345 of ~9,997, listed 65 XCH)

```
floor             = 13.75 XCH
percentile        = 345 / 9997 = 3.45%  → R = 0.8 (rare)
rarityPremium     = 13.75 × 0.8 = 11.00
baseEstimate      = 13.75 + 11.00 = 24.75 XCH

rankCurve(345)    ≈ 35 XCH
traitLogScore     = Σ log(mult)·reliability·penalty   (Body "K32 (Jade)" +88%, n=7,
                    reliability 7/19≈0.37) -> modest
traitFactor       = clamp(exp(logScore), 0.6, 3.0)    ≈ 2.5 (was 5)
compsValue        ≈ 35 × 2.5 ≈ 87 XCH
effConf           = 0.52² = 0.27
cap               = 24.75 × 3 = 74.25  ->  compsValue = min(87, 74.25) = 74.25
final = 0.27 × 74.25 + 0.73 × 24.75 = 20.0 + 18.1 ≈ 38 XCH     (was 102)
shown as: Sales comps ▲ ≈ +13 (= ~38 − 24.75)
```

---

## Status

The levers below (log‑space stacking, reliability, rank‑correlation penalty, squared
confidence, comps‑pull cap) are **now implemented**. Remaining ideas for reviewers:

1. **The 5× trait clamp does a lot of heavy lifting** (35 → 174 here). Lower it (e.g. 3×), or dampen
   multiplicative stacking (e.g. only apply the single strongest trait, or sum in log‑space), to tame
   high‑end blow‑ups.
2. **Multi‑trait stacking is multiplicative.** Several mildly‑hot traits compound fast. A hedonic
   (additive/log‑linear) regression would be more principled than independent multipliers.
3. **Confidence at 0.5 still moves the number a lot** when compsValue ≫ baseEstimate. Consider a
   non‑linear confidence (e.g. conf²) or a tighter cap on how far comps can pull from base.
4. **Rank curve uses K=25 nearest by rank** regardless of how far those ranks are — sparse collections
   pull from distant ranks. Could add a max rank‑distance window.
5. **Trait premium baseline is rank‑curve‑relative**, so a trait common among already‑rare NFTs can
   double‑count rank. Worth checking for correlation between “hot” traits and low rank.

*Goal: a value that tracks real sales without letting a few high trait sales inflate the whole tail.*
