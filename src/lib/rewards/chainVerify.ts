// MisFitz Rewards — ON-CHAIN royalty verification (PURE). The pre-real-payout gate: independently confirm from
// chain data that a counted sale actually paid the royalty to the creator wallet in the same spend, and take the
// TRUE royalty/price/buyer/seller/provenance from the chain (not the marketplace record). A REAL reward manifest
// counts a sale ONLY if it verifies here. Deterministic (no clock reads); tolerates garbage provider input and
// fails CLOSED — never throws mid-batch, never mints money. See MISFITZ-REWARDS.md §7.

import { type Sale } from "./types";
import { type ChainSaleSpend, type RoyaltyChainProvider } from "./chainProvider";

const WALLET_RE = /^(xch1[0-9a-z]{40,}|did:chia:[0-9a-z]+)$/;
const Z = BigInt(0);

export interface ChainVerifyConfig {
  creatorAddress: string;   // where royalties must land (operator's creator wallet)
  royaltyBps: number;       // expected, 1000 = 10%
  minRoyaltyBps: number;    // tolerance floor (rounding dust), e.g. 990 — never 0
  minBlockDepth: number;    // confirmations required before a sale is final (reorg guard), e.g. 32
  maxPriceDriftBps: number; // chain price vs shadow(Dexie) price sanity, e.g. 500 = 5%
}

export type VerifyFailReason =
  | "no-spend-found" | "malformed-spend" | "nft-mismatch" | "not-xch" | "multi-nft-spend"
  | "creator-counterparty" | "insufficient-depth" | "royalty-missing" | "royalty-short" | "price-drift";

export interface RoyaltyVerification {
  verified: boolean;
  reason?: VerifyFailReason;
  retryable?: boolean;        // true ONLY for insufficient-depth (re-verify next run)
  royaltyMojos: bigint;       // ACTUAL creator payment (0 if unverified)
  priceMojos: bigint;         // ACTUAL from chain
  buyer: string; seller: string;
  coinId: string; spendId: string; blockIndex: number;
}

function fail(reason: VerifyFailReason, retryable = false): RoyaltyVerification {
  return { verified: false, reason, retryable, royaltyMojos: Z, priceMojos: Z, buyer: "", seller: "", coinId: "", spendId: "", blockIndex: 0 };
}

// Provider input is UNTRUSTED. Reject anything not structurally sound so the money checks below can't throw or
// pass on missing fields (a node-RPC provider returning JSON numbers, or omitting depth, is the likely week-1 bug).
function structurallyValid(spend: ChainSaleSpend): boolean {
  return typeof spend.nftLauncherId === "string" && spend.nftLauncherId.length > 0
    && typeof spend.buyer === "string" && typeof spend.seller === "string"
    && typeof spend.priceMojos === "bigint"
    && typeof spend.paidInXch === "boolean"
    && Number.isSafeInteger(spend.nftCountInSpend)
    && Number.isSafeInteger(spend.blockIndex)
    && Number.isSafeInteger(spend.blockDepth)
    && Array.isArray(spend.payments)
    && spend.payments.every((pmt) => pmt && typeof pmt.toAddress === "string" && typeof pmt.amountMojos === "bigint");
}

// First failing check wins. Order matters (cheap/structural first, money checks last).
export function verifyRoyalty(spend: ChainSaleSpend | null, sale: Sale, cfg: ChainVerifyConfig): RoyaltyVerification {
  if (!spend) return fail("no-spend-found");
  if (!structurallyValid(spend)) return fail("malformed-spend");
  if (spend.nftLauncherId !== sale.nftId) return fail("nft-mismatch");
  if (!spend.paidInXch) return fail("not-xch");
  if (spend.nftCountInSpend !== 1) return fail("multi-nft-spend"); // !== 1 (not >1) — a missing/0 count is not clean
  if (spend.blockDepth < cfg.minBlockDepth) return fail("insufficient-depth", true);

  const creator = cfg.creatorAddress.toLowerCase();
  // The creator being buyer OR seller means the sale principal lands on the creator address — counting it as
  // royalty would inflate the pot ~10x (a farmable exploit). A primary/creator-involved sale is not a normal
  // secondary-market reward event: exclude it.
  if (spend.seller.toLowerCase() === creator || spend.buyer.toLowerCase() === creator) return fail("creator-counterparty");

  const price = spend.priceMojos;
  if (price <= Z) return fail("royalty-missing");
  let royaltyPaid = Z;
  for (const p of spend.payments) {
    if (p.toAddress.toLowerCase() === creator && p.amountMojos > Z) royaltyPaid += p.amountMojos;
  }
  if (royaltyPaid <= Z) return fail("royalty-missing");
  // Actual royalty must be at least minRoyaltyBps of the actual price. Overpayment is fine (creator's gain);
  // royaltyMojos = exactly what landed, so computeEpoch (which treats royalty as ground truth) stays solvent.
  if (royaltyPaid * BigInt(10000) < price * BigInt(cfg.minRoyaltyBps)) return fail("royalty-short");

  // Guard against a wrong-spend match: chain price shouldn't diverge wildly from what Dexie reported.
  if (sale.priceMojos > Z) {
    const drift = price > sale.priceMojos ? price - sale.priceMojos : sale.priceMojos - price;
    if (drift * BigInt(10000) > sale.priceMojos * BigInt(cfg.maxPriceDriftBps)) return fail("price-drift");
  }

  return { verified: true, royaltyMojos: royaltyPaid, priceMojos: price, buyer: spend.buyer, seller: spend.seller, coinId: spend.coinId, spendId: spend.spendId, blockIndex: spend.blockIndex };
}

// Verified chain truth REPLACES the shadow sale's assumed royalty/attribution/price + stamps provenance. The
// deal tag (bonusWinner) stays FROZEN from shadow tag time (spec §5); the bonus is paid to the verified buyer/
// seller. If a side didn't resolve on chain, it keeps its placeholder → settlement burns that slice.
export function reconcileSale(shadow: Sale, v: RoyaltyVerification): Sale {
  return {
    ...shadow,
    buyer: v.buyer || shadow.buyer,
    seller: v.seller || shadow.seller,
    priceMojos: v.priceMojos,
    royaltyMojos: v.royaltyMojos,
    coinId: v.coinId,
    spendId: v.spendId,
    blockIndex: v.blockIndex,
  };
}

export interface Partition {
  verified: Sale[];                                   // enter computeEpoch for a REAL manifest
  retry: Sale[];                                      // not final yet (depth) — re-verify next run
  rejected: { sale: Sale; reason: VerifyFailReason }[]; // NOT counted anywhere (not even burn) — operator audit
}

// Defense-in-depth for the REAL pipeline: before a reward manifest is stamped "chain-verified", assert every
// sale funding it actually carries chain provenance. The operator signature is the primary attestation; this
// catches a mis-wired pipeline that sets the flag without running verifySales.
export function assertVerifiedSales(sales: Sale[]): void {
  for (const s of sales) if (!s.spendId || !s.coinId) throw new Error(`sale ${s.id} is not chain-verified (no provenance) — refusing to build a chain-verified manifest`);
}

export function partitionVerified(results: { shadow: Sale; v: RoyaltyVerification }[]): Partition {
  const verified: Sale[] = [];
  const retry: Sale[] = [];
  const rejected: { sale: Sale; reason: VerifyFailReason }[] = [];
  for (const { shadow, v } of results) {
    if (v.verified) verified.push(reconcileSale(shadow, v));
    else if (v.retryable) retry.push(shadow);
    else rejected.push({ sale: shadow, reason: v.reason ?? "no-spend-found" });
  }
  return { verified, retry, rejected };
}

// The gate: look up each shadow sale on chain, verify, partition. Only `verified` sales fund a REAL manifest.
// Rejects the whole run if the creator address is malformed (fail closed on config, not per-sale).
export async function verifySales(sales: Sale[], provider: RoyaltyChainProvider, cfg: ChainVerifyConfig, windowMs = 30 * 60_000): Promise<Partition> {
  // Fail closed on bad config (a 0 tolerance or 0 depth would silently disable a safety check).
  if (!WALLET_RE.test(cfg.creatorAddress)) throw new Error("chainVerify: invalid creatorAddress");
  if (!(cfg.minRoyaltyBps >= 1 && cfg.minRoyaltyBps <= 10000)) throw new Error("chainVerify: minRoyaltyBps out of range [1,10000]");
  if (!(cfg.minBlockDepth >= 1)) throw new Error("chainVerify: minBlockDepth must be >= 1");
  if (!(cfg.maxPriceDriftBps >= 0)) throw new Error("chainVerify: maxPriceDriftBps must be >= 0");
  // Derive block depth OURSELVES from the peak (don't trust the provider's blockDepth field).
  const peak = await provider.peakHeight().catch(() => null);
  const results = await Promise.all(sales.map(async (shadow) => {
    const spend = await provider.findSaleSpend({ nftId: shadow.nftId, aroundMs: shadow.soldAt, windowMs, dexieOfferId: shadow.id }).catch(() => null);
    const adj = spend && typeof peak === "number" && Number.isSafeInteger(spend.blockIndex)
      ? { ...spend, blockDepth: peak - spend.blockIndex }
      : spend;
    return { shadow, v: verifyRoyalty(adj, shadow, cfg) };
  }));
  return partitionVerified(results);
}
