# Streamlining the Load — Diagnosis & Plan

## TL;DR

The site doesn't feel bad because it's *slow* — it feels bad because it's **churny**. When you open a
collection, the entire NFT list gets thrown away and rebuilt **10+ times** in a row (SSR → full fetch →
4 enrichment chunks → a warming re-poll every 15s, up to 24 times). Each rebuild re-sorts everything,
re-derives the filter options, and re-renders the whole grid *and* sidebar. The filter bar feels clanky
because the trending-traits section is recomputed and re-mounted on every one of those rebuilds, and it
changes the sticky sidebar's height each time (the "in and out").

The fix is **not** "optimize React." It's: *stop rebuilding the world.* Load the list once, then **merge**
updates into it in place, and feed the filter bar from **one stable source** instead of the streaming cards.

---

## What actually happens when you open a collection (the churn)

1. **SSR paint:** ~60 cards (rank + value, no traits, no listings).
2. **`/all` returns (~1–3s):** `setNfts(data.nfts)` **replaces the whole array** with the full collection
   (can be 12k cards). → `filtered` re-sorts all of them, `traitOptions` re-scans all of them,
   `trendingTraits` recomputes, the grid + sidebar re-render.
3. **Enrichment (4 chunks of 24):** each chunk POSTs to `/api/binder`, then `setNfts(prev => prev.map(...))`
   — a **new whole-array identity** every chunk. → every memo recomputes, headline numbers + tier counts
   jump, ~5–10 times.
4. **Warming re-poll (the main villain):** every **15 seconds, up to 24 times (≈6 minutes)** it re-fetches
   `/all` and calls `setNfts(data.nfts)` — a **full replace** that:
   - **throws away the traits/values enrichment just filled in** (cards blink out, then re-enrich),
   - re-sorts + re-derives everything again,
   - swaps `hotTraits` → the trending section flickers,
   - re-triggers enrichment for the visible set.

So a single collection view does **~10 full-collection rebuilds**, several of which are pure waste
(re-poll discarding enrichment). That cascade is the glitchiness.

---

## Why the filter bar "goes in and out" (the specific complaint)

- `trendingTraits` is derived from `hotTraits × traitOptions`. **Both** change on every re-poll and every
  enrichment merge, so the trending chips recompute constantly.
- The section renders conditionally (`trendingTraits.length > 0`). When a poll briefly changes the data,
  it **unmounts/remounts** → the sticky sidebar's height jumps → the "in and out" you feel.
- The trait **dropdowns** are built from the *enriched visible cards* (only ~120 of them), so they also
  grow and reshuffle as enrichment streams in — meaning the filter options are both **incomplete** and
  **unstable** at the same time.

---

## The plan — ranked by impact ÷ effort

### 1. Serve stable, complete filter options from the server  ← *fixes the clank directly*
Return the full trait list (type → values) in the `/all` response — we already have it in the
frequency table / comps model. The client uses that as `traitOptions`: **complete immediately, and it
never changes as enrichment streams.** This alone stops the dropdowns and trending chips from churning,
and fixes the "filter only shows some traits" bug at the same time.

### 2. Load the list once, then MERGE — never replace  ← *biggest overall win*
After the first `/all`, all later updates (enrichment chunks, warming re-polls) should **merge changed
fields into existing cards by id**, preserving everything else — no whole-array identity churn, no
"traits blink out." Concretely: the warming re-poll should patch value/rank in place, not
`setNfts(wholeNewArray)`.

### 3. Make the trending section layout-stable
Once it appears, **keep it mounted and reserve its height**; update chip contents in place with a soft
fade, and don't unmount on a momentarily-empty poll. Only re-set `trendingTraits` when the *content*
actually changed (dedupe identical updates). Result: it stops popping in and out.

### 4. Tame the warming re-poll
It's the main churn source. Best combo: **merge instead of replace** (from #2, makes it invisible) **+
back off** (e.g., 20s → 40s → 80s, stop after ~3 tries) instead of every 15s × 24. Keeps the benefit
(values sharpen) without the visible thrash.

### 5. Dampen the headline-number jitter
The Traitfolio value + tier counts recompute on every enrichment chunk, so they visibly jump 5–10 times.
Update them **once when enrichment settles**, or debounce to ~1 update/sec, so the number counts up
calmly instead of strobing.

### 6. Image + skeleton polish
- Card images **hard-pop** in (no placeholder). Add a fade-in / blur placeholder.
- The portfolio skeleton uses hardcoded white (`bg-white/10`) → **invisible in light mode**. Use theme
  variables (the binder skeleton already does this correctly — copy that).
- We already added the corner "working" pill with an 800ms linger — good. Standardize on **three**
  loading treatments only: page skeleton, corner pill, image fade.

### 7. Cheap React wins
- Wrap `NftRarityCard` in `React.memo` + memoize the `onOpen` handler so stable cards don't re-render on
  every parent state change (right now they all do, every chunk).
- Precompute a lowercase trait-type lookup so trending-trait matching is O(1), not O(traits) per chip.

---

## What to cut or simplify (return not worth the load)

- **CUT the aggressive 6-minute / 24× warming re-poll.** Replace with merge + short backoff (#2, #4).
  The current version's cost (constant full rebuilds) far outweighs its benefit (values sharpening a bit
  sooner). Keep the *sharpening*, kill the *thrash*.
- **CUT deriving filter options from streaming cards.** Serve them once from the server (#1). Simpler,
  complete, stable.
- **KEEP trending traits.** It's a real differentiator and you like it — the problem was never the
  feature, it was the churn around it. Stabilize it (#3), don't remove it.
- **CUT the per-chunk headline recompute.** Compute the value/tier totals once when enrichment settles (#5).

---

## Recommended order

1. **#1 Stable trait options from `/all`** — kills the clanky filter bar directly, and completes the
   trait dropdowns. Highest felt impact.
2. **#2 Merge-not-replace** for the warming re-poll + enrichment — removes the "blink out / rebuild" churn.
3. **#3 Layout-stable trending section + fade** — stops the in/out.
4. **#5 Debounce headline numbers**, then **#6 image/skeleton polish**, then **#7 React.memo**.

Doing **1–3 first** is roughly 80% of the felt smoothness for a fraction of the work. They're also low-risk
(no valuation/data-logic changes — purely how updates are applied and rendered).

---

## One-line summary

Stop throwing the list away and rebuilding it; load it once, patch it in place, and feed the filter bar
from one stable server-provided source. That single shift removes almost all the glitchiness — including
the clanky trending bar — without touching any of the pricing or rarity logic we've built.
