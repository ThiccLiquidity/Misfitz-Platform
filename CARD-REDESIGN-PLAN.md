# Card redesign — implementation plan

Agreed design: printed 90s trading card, true 5:7, tier-token driven. Mockups live as desktop artifacts
`traitfolio-card-final`, `traitfolio-modal-design`, `traitfolio-shape-and-type` (the last two are authoritative).
**Nothing in this plan is built yet.** Approve it before code starts.

---

## 1. What we're actually fixing

The visual refresh is the visible half. The half that matters long-term is the CSS architecture.

Card styling today is **combinatorial** — 6 tiers × 2 themes × every element, each written by hand:

| Family | Rules | ~Lines |
|---|---|---|
| `.tcg-body-*` | 154 | 1,738 |
| `.tcg-art-bg-*` | 75 | 622 |
| `.tcg-binder-grid` | 61 | 1,024 |
| `.tcg-rank-tag/num/lbl-*` | 112 | 321 |
| `.tcg-art-zone` | 50 | 755 |
| `.tcg-outer-*` | 32 | 201 |
| panel + stats + labels | 64 | 375 |
| trait sub-system | 70 | 241 |
| …46 families total | **449** | **~2,021** |

That's **69% of globals.css**. It is why the card header silently drifted out of sync — one visual decision
lives in 12+ rules and it's easy to miss one.

After: **six token blocks** feeding one set of structural rules. Target **60–80 blocks**, ~350 lines.
"Make legendary glow harder" becomes one number.

---

## 2. The architecture

Six blocks. Everything else reads from them.

```css
.tier-common    { --ink-a:#8592a5; --ink-b:#465264; --txt:#e6ebf2; --glow:0 0 0 transparent;
                  --holo:0;   --foil:0;   --fw:3px;   --lift:0px; }
.tier-uncommon  { --ink-a:#7fa96f; --ink-b:#3d6634; ... --holo:.20; --foil:.25; --fw:3.5px; --lift:0px; }
.tier-rare      { ... --holo:.36; --foil:.5;  --fw:4px;   --lift:1px; }
.tier-epic      { ... --holo:.52; --foil:.7;  --fw:4.5px; --lift:2px; }
.tier-legendary { ... --holo:.66; --foil:.85; --fw:5px;   --lift:3px; }
.tier-mythic    { ... --holo:.80; --foil:1;   --fw:5.5px; --lift:4px; }
```

Six escalation dials move together: **pigment · foil · glow · frame thickness · lift · art tint.**

Four material techniques, all pure CSS, no assets:
- **Pigment palette** (not screen-RGB) — this is what stops it looking electric.
- **Cardstock grain** — inline SVG turbulence, overlay blend, ~30%.
- **Emboss** — four inset shadows, light top-left / shadow bottom-right.
- **Refraction foil** — two opposed gradient layers plus a drifting hotspot on `soft-light`.

**Performance rule, non-negotiable:** foil animates only from **Epic upward** (rare by definition, few on
screen), static sheen below, and `prefers-reduced-motion` fully respected. A 100-card page must not cook a phone.

---

## 3. Migration strategy — build alongside, flip, then delete

**Not an in-place rewrite.** A new namespace built beside the old one, switched by a flag.

- New component `src/components/nft/TradingCard.tsx`, new CSS namespace `.card-*`.
- Old `NftRarityCard` + `.tcg-*` untouched and still live throughout.
- `NEXT_PUBLIC_NEW_CARD=1` picks the new one at the three call sites.
- Flip on when it's right; **delete `.tcg-*` only after** the new card has been live and unremarked.

Why: this is ~2,000 lines of CSS with **no visual regression tests**. In-place means a broken intermediate
state and no way back. Alongside means the old card is always one env var away, and rollback is instant.

---

## 4. The five surfaces

| # | Surface | File | How it migrates |
|---|---|---|---|
| 1 | Binder grid | `BinderView.tsx` | Swap component; sleeve gets the plastic-pocket treatment |
| 2 | Binder page spread | `BinderPage.tsx` | Same swap, ring/page chrome updated |
| 3 | Detail modal | `NftDetailModal.tsx` (585 ln) | Card swaps automatically (`:160`); **the certificate panel is a rewrite** |
| 4 | Theme lab | `ThemeLab.tsx` | Becomes the verification gallery — see §6 |
| 5 | **SOLD share image** | `SoldShowcase.tsx` `drawCard()` | **Hand-redrawn on canvas.** Shares zero CSS. ~1 day alone |

Surface 5 is the one that gets forgotten. If it isn't redrawn, every shared SOLD graphic advertises the old design.

---

## 5. Phases — shippable at every boundary

**Phase 0 · Tokens + card shell — 1 day**
Token block, `TradingCard.tsx` at true 5:7, materials, flag off. Renders only in theme-lab.
*Ships: nothing user-visible.*

**Phase 1 · Binder surfaces — 1 day**
Grid + page spread behind the flag; plastic sleeve treatment; type set in Righteous/Inter/Caveat.
*Ships: nothing user-visible. Flag on locally for review.*

**Phase 2 · The certificate modal — 1.5–2 days**
Rewrite the panel: paired estimated/listed values, deal-score meter, single primary buy action, traits with
inline rarity %, recent sales. Re-home the CAT warning, list-price coach and value breakdown. Day + night.
*Ships: nothing user-visible.*

**Phase 3 · Flip + soak — 0.5 day**
Flag on in production. Both code paths still present. Watch for a few days.
*Ships: the redesign.*

**Phase 4 · Canvas SOLD image — 1 day**
Redraw `drawCard()` to match: frame gradient, grain, emboss, plate, rank sticker.
*Ships: share graphics that match the site.*

**Phase 5 · Delete the old system — 0.5 day**
Remove `NftRarityCard`, all 449 `.tcg-*` rules, the flag. Expect **−1,600 lines**.
*Ships: nothing user-visible. Everything gets cheaper afterwards.*

**Total: 5.5–6.5 days.** Phases 0–2 are invisible, so they can land in any order relative to other work.

---

## 6. Verification — the actual risk

The risk is not the code, it's that **there are no visual regression tests** and the matrix is
6 tiers × 2 themes × 5 surfaces × 2 viewports = **120 states**.

Mitigation: extend `/theme-lab` (already env-gated, already exists) into a **card gallery** rendering all six
tiers in both themes across every surface on one page. That turns 120 manual checks into two screenshots, and
it's reusable for every future card change. Roughly 2 hours, and it pays for itself inside this project.

Per-phase gate: `npx tsc --noEmit` clean · `npm test` green · gallery eyeballed in both themes · one real
collection and one real wallet checked at desktop and ~390px.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Foil animation drops scroll framerate | Epic+ only; `prefers-reduced-motion`; test on a real phone in Phase 1 |
| `color-mix()` / `aspect-ratio` support | Both are baseline in all current browsers; static fallback colour per tier |
| Losing on-card deal score hurts deal-hunters | Decided: modal only. Revisit after soak if collectors complain |
| Canvas SOLD drifts from CSS card | Phase 4 is explicit, not optional; gallery includes a canvas render |
| Old CSS deleted too early | Phase 5 gated on a soak period with the flag on |

---

## 8. Sequencing against multi-chain

These barely overlap — the card work is components + `globals.css`, multi-chain Phase 0 is
`nftCache.ts`/types/`col1` predicates. They can run in either order.

**Recommendation: multi-chain Phase 0 first** (~1 day). It's the only finding in the audit that fails
*silently* — chain-less cache keys would serve wrong NFTs with no error path — and every week of new Chia-only
code makes it more expensive. The card redesign has no such decay.

---

## 9. Still open

1. Font pairing — **Righteous + Inter** is my pick; Shantell Sans and Inter-only were the alternatives.
2. Commissioned textures (foil sheet, cardstock, holo lattice — 40–80 KB) for the last 20% of realism.
   Not a blocker; the token system makes it one line per tier later.
3. Whether `/theme-lab` should become a permanent internal tool (recommended) or stay a scratch page.
