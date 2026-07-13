// MisFitz Rewards — chain provider INTERFACE (operator-implemented; we ship no implementation). The operator
// wires this to their Chia full node RPC (get_coin_records / get_puzzle_and_solution) or an indexer. It returns
// the on-chain settlement spend for a sale so the PURE verifier (chainVerify.ts) can confirm the royalty was
// really paid — replacing the shadow "assume 10%" attribution before any REAL payout. No keys, no funds here.

export interface ChainPayment { toAddress: string; amountMojos: bigint }

export interface ChainSaleSpend {
  nftLauncherId: string;      // the NFT that moved in this spend (must equal the sale's nftId)
  buyer: string;             // new owner (xch1…)
  seller: string;            // received the trade principal (xch1…)
  payments: ChainPayment[];  // ALL XCH payments the settlement spend created
  priceMojos: bigint;        // total XCH the buyer paid (principal + royalty)
  paidInXch: boolean;        // false if the NFT was priced in a CAT (engine is XCH-mojo based)
  nftCountInSpend: number;   // >1 for a bundle offer (per-NFT royalty is ambiguous)
  coinId: string;
  spendId: string;
  blockIndex: number;
  blockDepth: number;        // confirmations at query time (peak - blockIndex); reorg guard
  timestamp: number;         // ms epoch
}

export interface RoyaltyChainProvider {
  // Find the settlement spend for one shadow sale: the ownership-transfer spend for `nftId` nearest `aroundMs`
  // (within ±windowMs). `dexieOfferId` is an optional stronger hint for indexer-backed impls. null = not found.
  findSaleSpend(q: { nftId: string; aroundMs: number; windowMs: number; dexieOfferId?: string }): Promise<ChainSaleSpend | null>;
  peakHeight(): Promise<number>;
}
