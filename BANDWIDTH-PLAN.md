# Traitfolio — Upstash Bandwidth Plan (deep dive)

_Date: July 2026. Status: production DB (Upstash Fixed 1GB, $20/mo) at **90 / 100 GB** monthly
bandwidth with unknown reset date. Goal: don't get the site cut off, and don't overpay._

## TL;DR
- **Root cause found.** Every cached NFT detail blob embeds the *entire* per-collection trait-frequency
  table (`attributes_frequency_counts`), so each detail is ~**30–40 KB** instead of ~1.5 KB. Binder
  enrichment re-reads thousands of these per view. One 1,000-card binder view ≈ **~30 MB** of Redis
  bandwidth; ~100 such views/day ≈ **~3 GB/day ≈ ~90 GB/mo**. This one flaw is almost the whole bill.
- **Emergency fixes** (below) cut the daily burn from ~3 GB to well under 1 GB — enough runway to reach
  reset on the current plan.
- **Billing safety net:** switching Upstash to **Pay-as-you-go doubles the free bandwidth to 200 GB and
  removes the hard cutoff** (overage $0.03/GB); the only new cost is per-command ($0.20 / 100k) — check
  the dashboard command count first.
- **Long term:** move the handful of mega-blobs to **Cloudflare R2 (zero egress)** and slim payloads →
  steady-state ~15–30 GB/mo, comfortably inside any plan.

## Runway math
At ~3 GB/day, the last 10 GB burns in ~3 days. Shipping Emergency #1–#3 → ~0.5–1 GB/day → the remaining
10 GB stretches to ~10–20 days, which should clear the monthly reset. (Reset date isn't shown in the email;
it's on the Upstash console → database → Usage.)

## Top bandwidth consumers (Fable audit, measured against the local cache mirror)
1. **Per-NFT detail MGETs during binder enrichment** — `getNftDetailsBatch` → `cachedDetailJsonMany`
   (nftCache.ts:160) → `/api/binder` (service.ts:202) and every comps rebuild (compsService.ts:107).
   ~30 KB/detail (78% of which is the embedded freq table). **~50–65% of total.** Also: MGET hits
   *bypass* the in-process L1 cache, so warm lambdas re-read identical details every chunk/poll.
2. **Collection `/all` cold-origin big-blob reads** — `slimlist2` (0.3–3 MB), `sales`, `comps`, `vidx`.
   Amplified by wallet SSR stamping up to 40 collections' rosters, and `/api/values` polls re-kicking
   `getAllCollectionCards`. **~15–25%.**
3. **Whale wallet scans** — `holdscan`/`slimscan` checkpoints are re-read *and rewritten with all items so
   far* on every warming poll (O(N²) bytes). `holdings3` re-reads (now 45s-memoized). **~10–15%.**
4. **Nightly warm cron** (`/api/warm`, `0 8 * * *`, ≤50 collections incl. comps rebuild MGETs) —
   **~15–20 GB/month by itself**, independent of traffic.

## Tier 1 — EMERGENCY (deployable now, ranked impact ÷ risk)
1. **Stop storing the freq table in every detail.** Drop `attributes_frequency_counts` (and trim `events`)
   from `slimNftDetail` (client.ts:165,173). Enrichment + comps already fall back to
   `getCollectionFrequency` / `tf:c:` meta. **~halves total bandwidth.** Risk: low-med (verify trait-rarity
   % still renders on one collection). _Zero visible UX change intended._
2. **L1-memo `getNftDetailsBatch`** (client.ts:261): check the in-proc `_cache` before the MGET and write
   hits back. Kills repeat re-reads on warm lambdas. Risk: very low. _No UX change._
3. **Pause the nightly warm cron** — remove the `/api/warm` line in `vercel.json` (or unset its secret).
   Saves ~15–20 GB/mo instantly; cold first-visitors still load via the warming UX. Risk: nil, reversible.
4. **Raise `/all` edge cache** `s-maxage=600 → 1800` (all/route.ts). Fewer cold-origin blob reads. Risk:
   collection cards up to 30 min staler at the CDN (values still converge via `/api/values`).
5. **Throttle `/api/values`** so a "pending" poll doesn't re-kick `getAllCollectionCards` every time
   (values/route.ts:28) — 5-min per-collection guard. Risk: very low.
6. **(UX tradeoff — owner's call)** comps rebuild width `MAX_NFTS 300→100` (compsService.ts:45) and hot
   refresh age `20→60 min`; `ENRICH_CAP 1000→300` (YourBinder.tsx:43). More savings, slight precision/
   coverage cost. Left OUT of the default emergency ship pending your OK.

## Tier 2 — STRUCTURAL (stay under 100 GB permanently)
1. **Per-collection freq table as its own key** (`tf:freq:{col}`), fetched once per lambda, never embedded
   in details or `tf:c:` meta. (Completes Emergency #1.)
2. **Move mega-blobs off Upstash to Cloudflare R2** (zero egress): `slimlist2`, `rarityfreq`,
   `holdings3`/`holdscan`, `slimscan`, `pwallet`. `cacheGetLarge/PutLarge` is already a clean seam — swap
   the backend behind it. Removes the O(N²) checkpoint churn from Redis. Est. −25–35% of today's bandwidth.
3. **Derive binder enrichment from rosters, not per-NFT details** — traits/rank/value are all in
   `slimlist2` + `rarityfreq` + `vidx` (the artifact-stamp path already proves it). Retires the #1 consumer
   structurally. Est. −40–50%.
4. **Slim `slimRosterItem`** (liveCollection.ts:115) into a traits-only variant for stamping. −40–60% roster
   bytes.
5. **Collapse the binder poll fan-out** (your pending task #213): one round-trip returning traits+values.

## Tier 3 — BILLING / PROVIDER OPTIONS (2026 pricing)
| Option | Bandwidth | Cutoff behavior | Monthly cost | Notes |
|---|---|---|---|---|
| **Stay on Fixed 1 GB** | 100 GB incl. | **Hard stop** unless auto-upgrade | $20 | Current. The cliff we're on. |
| Enable Auto-Upgrade | bumps to next Fixed tier | auto-charges up | jumps to **$100** (Fixed 5 GB) | Email's suggestion; expensive. |
| **Upstash Pay-as-you-go** | **200 GB free**, then $0.03/GB | **no cutoff**, just overage | ~$0 bw + **$0.20/100k commands** | Doubles headroom + safety net. Verify command count first (Fixed has no command charge; PAYG does). |
| Cloudflare R2 for blobs | egress **free** | n/a | $0.015/GB-mo storage + tiny op fees; 10 GB free | Structural; pairs with any plan. |
| Redis Cloud free | 30 MB | n/a | free | Too small — not viable. |

## Recommended sequence
1. **Now:** ship Emergency #1–#5 (no UX change) → survive to reset.
2. **This week:** check the Upstash console for reset date + command count; if commands are modest, switch
   to **Pay-as-you-go** for the 200 GB ceiling + no-cutoff safety net.
3. **Soon:** Tier-2 #1 (freq key) + #2 (R2 for mega-blobs) for permanent headroom.
4. Add a per-key **byte counter** to `/api/status` (wrap the get/set/mget calls in nftCache.ts) so we
   measure the top keys instead of estimating.

---

## Enabling Cloudflare R2 (the structural fix — your steps)
The pluggable blob backend is built and flag-gated: with no R2 env vars the app uses Redis exactly as
before. To move the big blobs (rosters, rarity tables, wallet holdings) onto R2's zero-egress storage:

1. **Create the bucket.** Cloudflare dashboard → R2 → *Create bucket* → name it e.g. `traitfolio-cache`.
2. **Create an API token.** R2 → *Manage R2 API Tokens* → *Create API token* → permission **Object Read & Write**,
   scoped to that bucket. Copy the **Access Key ID**, **Secret Access Key**, and your **Account ID** (shown in
   the R2 overview / endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
3. **Set env vars in Vercel** (Project → Settings → Environment Variables) and your local `.env`:
   ```
   R2_ACCOUNT_ID=<account id>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret>
   R2_BUCKET=traitfolio-cache
   TRAITFOLIO_BLOB_STORE=r2
   ```
   (Leaving `TRAITFOLIO_BLOB_STORE` unset also works once the four R2 vars are present — it auto-enables.
   Set it to `redis` to force the old path back.)
4. **Add a lifecycle rule** on the bucket to garbage-collect old objects (R2 → bucket → Settings → Object
   lifecycle → delete objects after e.g. **7 days**). The code also freshness-checks each object on read, so
   stale blobs are ignored regardless; the rule just keeps storage tiny.
5. **Deploy.** On the first read after enabling, a blob not yet on R2 falls back to the existing Redis copy
   (migration is seamless — no cache wipe); new writes go to R2. Redis bandwidth for these blobs then drops
   to ~zero as traffic shifts to R2.
6. `npm install` (pulls `aws4fetch`, the R2 request signer) before the build.

Cost on R2: storage only (~$0.015/GB-month; first 10 GB free), reads are free. For Traitfolio's blob volume
that's effectively $0.
