# Nostalgia Mode — feasibility + prototype (Task 3)

Status: **hidden prototype shipped behind a flag. Not user-facing.** A treat, not a launch item.

## The idea
A third theme beyond light/dark: a full 90s-childhood skin — a binder open on a table, warm Saturday-morning
palette, NFT cards sitting in 9-pocket plastic sleeves, chunky primary-color accents (Trapper-Keeper red,
crayon blue), pogs/Nintendo-controller flair.

## Honest feasibility

**Good news: the theming architecture makes a third mode genuinely cheap.** Themes are a
`Record<ThemeMode, ThemeTokens>` (`src/lib/theme/themes.ts`) injected as CSS variables, plus
`[data-theme="…"]` override blocks in `globals.css`, with a `data-theme` attribute on the AppShell wrapper.
Adding `"nostalgia"` was: one token palette + one CSS block + a hidden activation path. No component rewrites —
every binder/card/nav element already reads the CSS vars, so they re-skin automatically.

There are two honest tiers:

**Lightweight (what's built now) — ~half a day, done.** A CSS-only skin: wood-grain desk background, manila
binder pages with a red trapper-keeper trim, plasticky card sleeves, marker-ink headings. It reads as
"nostalgic" from the palette and texture alone, with **zero image assets** — so it previews today and can be
critiqued before spending on art.

**Dream version — needs commissioned art + some new markup.** The full "binder physically open on a messy
kid's desk" look (real wood photo, spiral binding, scattered pogs, a Nintendo controller peeking in, a CRT
glow) needs illustration/photography and a few decorative DOM layers (corner stickers, a desk "tray" frame
around the binder). That's the part gated on art, not code. The prototype already exposes the seams so art
drops in without a rewrite (see below).

**Cost/risk:** contained. It's additive and hidden — it can't affect light/dark users. The only ongoing cost
is that every future themed element should keep reading the CSS vars (it already does). No performance concern
(CSS only). Accessibility: the manila/brown palette needs a contrast pass before it ever goes user-facing.

## What the prototype does
- `ThemeMode` now includes `"nostalgia"` (`src/types/index.ts`), which forces a complete token palette (the
  `Record` type won't compile without it) — so it can never be half-defined.
- `themes.ts` — the nostalgia palette (wood desk, manila pages, crayon-primary accents).
- `globals.css` — a `[data-theme="nostalgia"]` block skinning the binder shell, pages, sleeves, headings, and
  desk background using CSS gradients (no images needed to preview).
- `ThemeProvider` — a **hidden** activation: append `?nostalgia=1` to any URL to turn it on (it's remembered
  in localStorage); `?nostalgia=0` clears it. Deliberately NOT wired into the visible light/dark toggle.

Try it: open the app with `…/binder?nostalgia=1` (or any route + `?nostalgia=1`).

## Art to commission (owner handles art) — drop-in seams
The CSS block defines three override variables so commissioned assets need **no code change** — just set them
(e.g. in the nostalgia block or on `:root[data-theme="nostalgia"]`) pointing at files in `/public/nostalgia/`:

- `--nostalgia-table-image` — the desk surface behind the binder. Ideal: a warm, slightly worn **wood
  desk/table** photo or illustration, ~2000px wide, tileable-ish or full-bleed. This is the single
  highest-impact asset.
- `--nostalgia-paper-image` — a subtle **manila/loose-leaf paper texture** overlaid on the binder pages
  (light, ~512px, tiling PNG, low contrast so text stays readable).
- `--nostalgia-sticker-image` — an optional **corner sticker** (a pog, a holographic star, a puffy sticker),
  transparent PNG, ~160px, for the top-left of the binder.

Nice-to-haves for the dream version (each is an added decorative layer, straightforward once art exists):
a **spiral-binding** strip for the binder's left edge; a **Nintendo-style controller** peeking in at a corner;
scattered **pogs/marbles** on the desk; a faint **CRT scanline/vignette** overlay. Flag these as separate
commissions — none block the lightweight skin.

## Recommendation
Keep it hidden for now. If the owner likes the lightweight preview, the cheapest path to shipping is:
commission the wood-desk + paper textures first (biggest visual payoff for least art), do a contrast/a11y
pass, then decide whether to add it as a real third option in the theme toggle. Everything past that (controller,
pogs, CRT) is polish that can land incrementally.

## Accessibility — contrast pass (done, this session)
The manila/cream page palette failed AA on two status colors used as text: `good` (3.1:1) and `fair`
(2.0:1, amber-on-cream — the classic offender). Both were darkened (`good` #1b6e2e = 5.7:1, `fair` #8a5500 =
5.6:1); `sub`/`bad` were nudged for margin. Headings (brown on manila) already pass (~10:1). The vibrant
trapper-keeper red stays on borders (3:1 UI-component bar, fine). **Remaining before user-facing:** a quick
audit that no subtle text renders directly on the dark wood desk (`vaultBg #7c5236`) — inside-the-binder text
is all on light pages, but confirm nav/chrome once the toggle is exposed.
