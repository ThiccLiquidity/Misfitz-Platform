// MisFitz Rewards - LP chain PROVIDER + TibetSwap client (SERVER-ONLY, network). Two jobs:
//   1. Read the $TOKEN/XCH pool from TibetSwap (reserves + LP-token TAIL + supply).
//   2. Read a wallet's LP-CAT balance. Chia has no "balance by asset" RPC, so this needs a full-node / Coinset
//      hint query (get_coin_records_by_hint) or Spacescan. That real integration is deferred; until it's wired,
//      the default provider returns 0 for everyone (the pool/leaderboard simply shows "not live yet"). The
//      interface is here so the real provider drops in without touching the reward math or job.
if (typeof window !== "undefined") throw new Error("rewards/lpProvider is server-only");

import { parseTibetPair, type TibetPair } from "./lpPool";

export const TIBETSWAP_API_BASE = process.env.TIBETSWAP_API_BASE ?? "https://api.v2.tibetswap.io";
// The $TOKEN TAIL - empty until the token is minted + the pool seeded. Everything below is dormant until set.
export const LP_TOKEN_ASSET_ID = process.env.LP_TOKEN_ASSET_ID ?? "";
// Monthly release of the 15% LP-rewards reserve: 3%/mo geometric (gentler than the holder drip's 5% so it lasts).
export const LP_REWARD_RATE_BPS = 300;

// Operator/team/pool-seed wallets to EXCLUDE from the LP census + leaderboard (comma/space separated xch1/DID),
// so a board topped by the team can never happen (spec 11.3). Case-insensitive.
export function lpExcludedWallets(): Set<string> {
  const raw = process.env.LP_EXCLUDED_WALLETS ?? "";
  return new Set(raw.split(/[,\s]+/).map((w) => w.trim().toLowerCase()).filter(Boolean));
}

async function getJsonOrNull(url: string, timeoutMs = 6000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

// Fetch the $TOKEN pool. Tries the per-asset endpoint, then the full /pairs list. null == pool not live yet.
export async function fetchTokenPair(tokenAssetId: string = LP_TOKEN_ASSET_ID): Promise<TibetPair | null> {
  if (!tokenAssetId) return null;
  const direct = await getJsonOrNull(`${TIBETSWAP_API_BASE}/pair/${encodeURIComponent(tokenAssetId)}`);
  const fromDirect = direct ? parseTibetPair(direct, tokenAssetId) : null;
  if (fromDirect) return fromDirect;
  const all = await getJsonOrNull(`${TIBETSWAP_API_BASE}/pairs`);
  return all ? parseTibetPair(all, tokenAssetId) : null;
}

// Per-wallet LP-CAT balance provider. Real impl (Coinset/Spacescan) drops in here later.
export interface LpChainProvider {
  lpBalanceUnits(wallet: string, liquidityAssetId: string): Promise<bigint>;
}

// Default until the on-chain reader is wired: everyone reads 0 (no pool -> empty, graceful shadow).
export class NullLpProvider implements LpChainProvider {
  async lpBalanceUnits(): Promise<bigint> { return BigInt(0); }
}

// Deterministic provider for tests / shadow demos - balances from an in-memory map keyed by wallet.
export class MockLpProvider implements LpChainProvider {
  constructor(private readonly balances: Map<string, bigint>) {}
  async lpBalanceUnits(wallet: string): Promise<bigint> { return this.balances.get(wallet) ?? BigInt(0); }
}

// Factory: swap in the real provider by env later; NullLpProvider by default (safe, dormant).
export function getLpProvider(): LpChainProvider {
  return new NullLpProvider();
}
