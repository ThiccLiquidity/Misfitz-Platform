# Night-shift autonomous work list

Safe, high-value work to do while the owner sleeps. Read CLAUDE.md first. Ground rules for this list:
- **Keep it green:** `npx tsc --noEmit` clean + `npm test` + the comps test (`node --test
  src/lib/valuation/__tests__/comps.test.mjs`) after every change. Commit in small, described batches.
- **No product decisions, no risky rewrites.** Do NOT remove the legacy auth stack (owner's call), do NOT
  deploy, do NOT change valuation PARAMETERS (ridge/half-lives/clamp/caps) — those are frozen until the
  backtest validates them (see LAUNCH-READINESS "launch gate"; tuning against unseen results is fine,
  tuning to make a number look good is not).
- **All edits via shell heredocs / temp-file writes** (the mount can truncate Write/Edit on large files).
- Work top-down; each item is independent. Skip anything that needs the network or a decision.

## Priority order

1. **Test-coverage expansion (pure modules).** Add unit tests for modules that lack them, to lock behavior:
   `rarity/tiers.ts` (tierIdForPercentile bands, getRarityTier), `format.ts`, `wallet/ownerId.ts`
   (parseOwnerIds — xch1/did parsing, dedup, junk), `valuation/estimate.ts` (rarityFactor anchors +
   monotonicity, robustFloor troll-resistance, null-floor), `valuation/range.ts`. Put them in `tests/`.

2. **Accessibility deep pass.** Add visible `:focus-visible` styles to interactive elements; ensure the
   NFT modal, lightbox, and MobileFilterSheet close on Escape and trap/return focus sanely; verify all
   icon-only buttons have aria-labels; check color contrast of subtle text in BOTH themes and darken where
   it fails WCAG AA. Keep changes CSS/markup-only.

3. **API route hardening.** In `src/app/api/*`, validate + bound inputs (id formats, array sizes, page
   sizes), return typed JSON errors instead of throwing, and never echo internals. Defensive only — don't
   change behavior for valid requests.

4. **Code-health sweep.** Remove any remaining dead exports/files; replace stray `any` with real types;
   make error handling consistent (all upstream calls already `.catch` to safe fallbacks — verify). Run a
   quick pass for `console.log` left in non-dev paths.

5. **Loading / empty / error consistency.** Make every route's loading.tsx + empty state + error boundary
   visually consistent (neutral skeletons, same spinner, same copy tone). Confirm no gold `--card-border`
   skeletons remain.

6. **SEO structured data.** Add JSON-LD (CollectionPage / BreadcrumbList) to the collection route via a
   `<script type="application/ld+json">` in the server component, using the collection name/desc/image.

7. **Comps guard tests (edge cases).** Add a couple more tests around the new guards: pair-decay actually
   reduces a repeated pair's influence vs distinct pairs; baseline clamp lower bound; thin cap releases
   once distinct NFTs ≥ threshold.

8. **Security self-review of the working history.** Skim the diff for: unsafe `dangerouslySetInnerHTML`
   (there's one theme script in layout — verify it's static), any fetch to a host derived from user input,
   secrets in code, and injection in API params. Write findings to `docs/SECURITY-NOTES.md`; fix only the
   clearly-safe ones, flag the rest.

## Explicitly OUT (needs the owner)
- Running the valuation backtest (needs network + non-sandbox esbuild) — owner runs `npm run backtest`.
- Removing legacy auth / Prisma pages; hosting/env/domain; changing valuation parameters.
