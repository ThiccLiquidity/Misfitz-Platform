# Security self-review (night-shift #116)

Scope: a code-level self-review of the live no-login app (browse / binder / collection + `/api/*`).
Not a substitute for a professional audit. Findings + status below.

## Reviewed & OK
- **XSS / HTML injection.** React escapes all rendered text by default. Only two
  `dangerouslySetInnerHTML` uses exist:
  - `layout.tsx` theme bootstrap — a STATIC inline script (no interpolation of external data). Safe.
  - Collection JSON-LD (`collection/[id]/page.tsx`) — serialized from external MintGarden data.
    **Fixed this pass:** escape `<` → `<` so a collection name containing `</script>` cannot break
    out of the tag.
- **SSRF / server fetch of user-controlled URLs.** The server only fetches fixed hosts (MintGarden,
  Dexie, CoinGecko). NFT image URLs from arbitrary hosts are rendered via `next/image` (client `<img>`),
  never fetched by our own data code. Path params are `encodeURIComponent`-ed.
- **API input.** `/api/*` routes validate id formats (`col1…`/`nft1…`/`xch1…`), bound cursor/query
  lengths and array/wallet counts, and wrap upstream calls in try/catch returning typed JSON (no 500 +
  stack leakage). (Hardened in #114.)
- **Financial safety.** The app never signs or executes trades or moves funds — buy actions link OUT to
  Dexie/MintGarden. CAT-inclusive offers are flagged and get no deal score. Estimate disclaimer present
  (footer + point-of-decision caption + info tab).
- **Client storage.** Only public wallet addresses are kept in `localStorage` (no secrets, no PII).
- **Secrets.** `.env` is gitignored; no secrets committed. `grep` finds no hardcoded keys/tokens.
- **Injection into upstream queries.** Dexie/MintGarden calls build URLs via `URLSearchParams` /
  `encodeURIComponent`; no string concatenation of raw user input into query logic.

## Flagged (owner action — already in LAUNCH-READINESS)
- **Rate limiting.** No app-layer limiter; relies on upstream limits + our cache. Consider a per-IP
  limiter on `/api/*` before a big launch spike.
- **Legacy auth in prod.** NextAuth/Prisma need `NEXTAUTH_SECRET`/`NEXTAUTH_URL`/`DATABASE_URL` or should
  be removed (product decision).
- **next/image allow-all-https.** Enables the optimizer to proxy any https image host (needed for
  arbitrary NFT art). Low risk; if abuse/cost matters, narrow to known gateways or use `unoptimized`.
- **Dependency audit.** Run `npm audit` on your machine (couldn't run reliably in the sandbox) and patch
  any high-severity advisories before launch.

## Not applicable (no-login product)
- No user accounts/passwords, sessions, CSRF-sensitive mutations, file uploads, or SQL (the live app uses
  read-only external APIs + a local cache; Prisma is legacy/unused by the live paths).
