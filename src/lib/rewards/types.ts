// MisFitz Rewards — domain types. ISOLATED module: imports nothing from the app and is imported by nothing
// in the live app. Pure logic + unit-tested. All money is bigint MOJOS (1 XCH = 1_000_000_000_000 mojos) so
// the accounting is exact — no floating point anywhere in the money path.
//
// See MISFITZ-REWARDS.md for the locked spec these types implement.

export const MOJOS_PER_XCH = BigInt(1_000_000_000_000);

// Which side, if any, won the deal bonus on a sale — frozen at sale time from the Traitfolio tag.
//  - "buyer"  : green/steal tag (buyer scooped an underpriced NFT)
//  - "seller" : premium/grail tag (seller sold above value)
//  - "none"   : fair tag (no bonus; that slice goes to burn instead)
export type BonusWinner = "buyer" | "seller" | "none";

// A single counted sale. The engine treats `royaltyMojos` (what actually landed on-chain) as the ground
// truth and derives everything from it, so we can never allocate more than we received. `priceMojos` is
// the sale price (= royalty / royaltyBps) and is only used for the vest comparison ("relisted cheaper").
export interface Sale {
  id: string;              // stable sale id (e.g. spend/coin id)
  nftId: string;           // the NFT that changed hands (launcher id)
  buyer: string;           // buyer wallet / owner id
  seller: string;          // seller wallet / owner id
  priceMojos: bigint;      // sale price in mojos
  royaltyMojos: bigint;    // ACTUAL royalty paid in the same spend (funds everything)
  bonusWinner: BonusWinner;// frozen from the tag at sale time
  soldAt: number;          // ms epoch timestamp (finality-adjusted upstream)
  // provenance for chain re-verification (stored, not used by the pure math)
  coinId?: string;
  spendId?: string;
  blockIndex?: number;
}

// A signal that could VOID a held buyer bonus: the watched NFT was listed or resold cheaper than the buyer
// paid, before the payout. We watch the NFT id (not the wallet), so alt-wallet dodges don't work.
export interface VestSignal {
  nftId: string;
  priceMojos: bigint;      // the list/sale price observed
  at: number;              // ms epoch timestamp
  kind: "list" | "sale";
}

// Basis-point config. Defaults are the LOCKED numbers: 10% royalty in; 1% artist + 2.5% buyer + 2.5% seller
// + 2.5% bonus out; burn = the residual. bps are expressed as a fraction of the SALE PRICE, but the engine
// computes them as a fraction of the ROYALTY (price = royalty * 10000/royaltyBps), which is equivalent and
// keeps solvency exact. Sum of (artist+buyer+seller+bonus) must be <= royaltyBps.
export interface RewardConfig {
  royaltyBps: number;  // 1000 = 10%
  artistBps: number;   // 100  = 1% of sale price
  buyerBps: number;    // 250  = 2.5%
  sellerBps: number;   // 250  = 2.5%
  bonusBps: number;    // 250  = 2.5% (tagged sales only)
}

export const DEFAULT_CONFIG: RewardConfig = {
  royaltyBps: 1000,
  artistBps: 100,
  buyerBps: 250,
  sellerBps: 250,
  bonusBps: 250,
};

// The five slices of a single sale's royalty, in mojos. Invariant (always, exactly):
//   artist + buyerReward + sellerReward + bonus + burn === royaltyMojos
export interface Slices {
  artist: bigint;
  buyerReward: bigint;
  sellerReward: bigint;
  bonus: bigint;       // 0n when bonusWinner === "none"
  burn: bigint;        // residual — absorbs integer-division dust so the invariant holds exactly
}

// Per-wallet payout for an epoch (all mojos).
export interface WalletPayout {
  wallet: string;
  buyerReward: bigint;   // 2.5% of every sale they bought
  sellerReward: bigint;  // 2.5% of every sale they sold
  bonus: bigint;         // vested bonuses paid this epoch
  total: bigint;         // sum of the three (XCH owed, before $CHIA conversion)
}

// One resolved bonus (for the audit trail / dashboard).
export interface BonusOutcome {
  saleId: string;
  nftId: string;
  winner: string;
  side: "buyer" | "seller";
  amountMojos: bigint;
  status: "paid" | "voided";  // voided -> its amount is added to burn
  reason?: string;            // e.g. "relisted at 0.9 XCH < 1.2 XCH paid"
}

export interface EpochResult {
  epochStart: number;
  epochEnd: number;
  saleCount: number;
  totalRoyaltyMojos: bigint;   // sum of counted sales' royalties = total "in"
  artistMojos: bigint;         // 1% slice, to creator wallet
  burnMojos: bigint;           // buy-and-burn pot (includes voided bonuses)
  rewardPotMojos: bigint;      // buyer + seller + paid bonus = total $CHIA buy this epoch
  payouts: WalletPayout[];     // sorted desc by total
  bonuses: BonusOutcome[];     // per-bonus audit
  // Solvency: solvent === (artist + burn + rewardPot === totalRoyalty). Must ALWAYS be true.
  solvent: boolean;
}
