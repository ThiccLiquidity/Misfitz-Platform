// MisFitz Rewards — leaderboard IDENTITY resolver (SERVER-ONLY, network + Redis-cached). Turns a handful of
// leaderboard wallets into a public name + avatar via MintGarden. Two tolerant paths, both fall back to null
// (the UI then shows just the truncated address):
//   • did:chia:…  -> GET /profile/{did}
//   • xch1…       -> read one NFT the address holds; MintGarden inlines the owner's public profile when the NFT
//                    is held under a DID (plain-address holders have no profile -> null).
// Results are cached per-wallet (positives 7d, "no profile" 1d so a newly-created profile shows up soon). Only
// the ~2 dozen leaderboard wallets are ever resolved — never the whole holder set — so cron cost is trivial.
if (typeof window !== "undefined") throw new Error("rewards/identity is server-only");

import { getProfile, listAddressNfts } from "@/lib/data-sources/mintgarden/client";
import { cacheGet, cachePut } from "@/lib/db/nftCache";
import { parseOptOut, identityOrOptOut } from "./identityCore";
import type { LeaderIdentity } from "./snapshotTypes";
import type { ProfileMap } from "./snapshotSerialize";

export { parseOptOut, identityOrOptOut } from "./identityCore";

const IDENT_KEY = (w: string) => `rw:ident:v1:${w}`;
const IDENT_TTL_MS = 7 * 24 * 60 * 60_000; // read-fresh window
const IDENT_EX_S = 7 * 24 * 60 * 60;       // positive cache: 7 days
const NEG_EX_S = 24 * 60 * 60;             // negative ("no profile"): 1 day — retry sooner
const MAX_RESOLVE = 60;                     // hard safety cap on wallets resolved per run

// ── Network resolution (per wallet) ─────────────────────────────────────────────
async function resolveOne(wallet: string): Promise<LeaderIdentity> {
  if (/^did:chia:/i.test(wallet)) {
    const p = await getProfile(wallet).catch(() => null);
    return { name: (p?.name ?? p?.username) ?? null, avatarUrl: p?.avatar_uri ?? null };
  }
  const page = await listAddressNfts(wallet, null, 1, "owned", false, true).catch(() => null); // background lane
  const it = page?.items?.[0];
  if (it?.owner_encoded_id) return { name: it.owner_name ?? null, avatarUrl: it.owner_avatar_uri ?? null };
  return { name: null, avatarUrl: null };
}

// Resolve a batch of leaderboard wallets to public identities. Keyed by the EXACT wallet strings passed in (so
// the serializer's per-wallet lookup matches). Opt-out is applied AFTER the identity cache read; note the
// PUBLIC snapshot bakes identities in at cron time, so an opt-out change only shows after the next recompute
// (plus the snapshot route's short CDN cache).
export async function resolveIdentities(wallets: string[], opts?: { optOut?: Set<string> }): Promise<ProfileMap> {
  const optOut = opts?.optOut ?? parseOptOut(process.env.REWARDS_PROFILE_OPTOUT);
  const uniq = Array.from(new Set(wallets.map((w) => w.trim()).filter(Boolean))).slice(0, MAX_RESOLVE);
  const map: ProfileMap = new Map();
  await Promise.all(
    uniq.map(async (w) => {
      const key = IDENT_KEY(w.toLowerCase());
      let ident: LeaderIdentity | null = null;
      try { const raw = await cacheGet(key, IDENT_TTL_MS); if (raw) ident = JSON.parse(raw) as LeaderIdentity; } catch { /* miss */ }
      if (!ident) {
        ident = await resolveOne(w);
        const ex = ident.name || ident.avatarUrl ? IDENT_EX_S : NEG_EX_S;
        try { await cachePut(key, JSON.stringify(ident), ex); } catch { /* best effort */ }
      }
      map.set(w, identityOrOptOut(w, ident.name, ident.avatarUrl, optOut));
    }),
  );
  return map;
}
