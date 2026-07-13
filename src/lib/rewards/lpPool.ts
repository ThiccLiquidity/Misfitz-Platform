// MisFitz Rewards - TibetSwap pool MATH + parsing (PURE, tested). A TibetSwap XCH/CAT pool exposes: the LP CAT's
// TAIL (liquidity_asset_id), the XCH reserve (mojos), the token reserve (CAT base units), and total LP-token
// supply. From those we can price any wallet's LP position (its redeemable XCH + $TOKEN right now). No network
// here - fetch lives in lpProvider.ts. All reserves/units are bigint.

export interface TibetPair {
  tokenAssetId: string;      // the $TOKEN TAIL
  liquidityAssetId: string;  // the LP CAT TAIL (what LPers hold in their wallet)
  xchReserveMojos: bigint;
  tokenReserveUnits: bigint;
  lpSupplyUnits: bigint;     // total LP tokens in existence == total pool depth
}

const toBig = (v: unknown): bigint | null => {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return null;
};

interface RawPair { asset_id?: unknown; liquidity_asset_id?: unknown; xch_reserve?: unknown; token_reserve?: unknown; liquidity?: unknown }

// Parse a TibetSwap /pairs response (array) OR a single /pair object into our TibetPair for the given token TAIL.
// Tolerant: returns null if the pair isn't present or any reserve field is malformed (pool not live yet).
export function parseTibetPair(json: unknown, tokenAssetId: string): TibetPair | null {
  const list: RawPair[] = Array.isArray(json) ? (json as RawPair[]) : json && typeof json === "object" ? [json as RawPair] : [];
  const p = list.find((x) => typeof x?.asset_id === "string" && x.asset_id === tokenAssetId);
  if (!p) return null;
  const liq = typeof p.liquidity_asset_id === "string" ? p.liquidity_asset_id : null;
  const xch = toBig(p.xch_reserve);
  const tok = toBig(p.token_reserve);
  const sup = toBig(p.liquidity);
  if (!liq || xch == null || tok == null || sup == null) return null;
  return { tokenAssetId, liquidityAssetId: liq, xchReserveMojos: xch, tokenReserveUnits: tok, lpSupplyUnits: sup };
}

export interface LpPosition {
  sharePpm: number;      // pool share in parts-per-million (for display)
  xchMojos: bigint;      // redeemable XCH right now
  tokenUnits: bigint;    // redeemable $TOKEN right now
}

// What a wallet's `lpUnits` of LP token are worth RIGHT NOW, as its pro-rata slice of the reserves.
export function lpPositionBreakdown(lpUnits: bigint, pair: TibetPair): LpPosition {
  const Z = BigInt(0);
  if (lpUnits <= Z || pair.lpSupplyUnits <= Z) return { sharePpm: 0, xchMojos: Z, tokenUnits: Z };
  const clamped = lpUnits > pair.lpSupplyUnits ? pair.lpSupplyUnits : lpUnits;
  const xchMojos = (pair.xchReserveMojos * clamped) / pair.lpSupplyUnits;
  const tokenUnits = (pair.tokenReserveUnits * clamped) / pair.lpSupplyUnits;
  const sharePpm = Number((clamped * BigInt(1_000_000)) / pair.lpSupplyUnits);
  return { sharePpm, xchMojos, tokenUnits };
}
