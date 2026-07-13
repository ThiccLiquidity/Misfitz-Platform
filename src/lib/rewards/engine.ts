// MisFitz Rewards — the pure payout engine. No I/O, no now(), no randomness. Given a set of counted sales +
// the vest signals observed + a config, it returns exactly what each wallet is owed, the artist slice, and
// the burn pot — with solvency guaranteed by construction (we only ever allocate the royalty we actually
// received). This is the money core; keep it pure and heavily tested.

import {
  DEFAULT_CONFIG,
  type BonusOutcome,
  type EpochResult,
  type RewardConfig,
  type Sale,
  type Slices,
  type VestSignal,
  type WalletPayout,
} from "./types";

const Z = BigInt(0);
const ONE_XCH = BigInt(1_000_000_000_000);

// Split ONE sale's royalty into its five slices. burn is the residual, so the five always sum EXACTLY to
// royaltyMojos regardless of integer-division dust, and burn >= 0 as long as the paid bps sum <= royaltyBps.
export function perSaleSlices(sale: Sale, cfg: RewardConfig = DEFAULT_CONFIG): Slices {
  const R = BigInt(cfg.royaltyBps);
  const r = sale.royaltyMojos;
  if (r < Z) throw new Error(`negative royalty for sale ${sale.id}`);
  const artist = (r * BigInt(cfg.artistBps)) / R;
  const buyerReward = (r * BigInt(cfg.buyerBps)) / R;
  const sellerReward = (r * BigInt(cfg.sellerBps)) / R;
  const bonus = sale.bonusWinner === "none" ? Z : (r * BigInt(cfg.bonusBps)) / R;
  const burn = r - artist - buyerReward - sellerReward - bonus; // residual absorbs rounding
  if (burn < Z) throw new Error(`config over-allocates royalty (bps sum > royaltyBps) for sale ${sale.id}`);
  return { artist, buyerReward, sellerReward, bonus, burn };
}

// Was a held bonus voided? True iff the watched NFT was listed OR resold STRICTLY cheaper than the purchase
// price, at any time after the sale and up to the payout. (Same-price or higher keeps it.)
function bonusVoided(
  nftId: string,
  purchaseMojos: bigint,
  soldAt: number,
  payoutAt: number,
  signals: VestSignal[],
): VestSignal | null {
  for (const s of signals) {
    if (s.nftId !== nftId) continue;
    if (s.at <= soldAt || s.at > payoutAt) continue; // only within (sale, payout]
    if (s.priceMojos < purchaseMojos) return s;       // strictly cheaper -> void
  }
  return null;
}

function fmtXch(mojos: bigint): string {
  const neg = mojos < Z;
  const abs = neg ? -mojos : mojos;
  const whole = abs / ONE_XCH;
  const frac = (abs % ONE_XCH).toString().padStart(12, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""} XCH`;
}

/**
 * Compute a full epoch payout from its final sale set + the vest signals observed up to payout.
 *
 * Vest model ("until the next monthly payout"): a sale in this epoch reaches its payout at THIS epoch close,
 * so every bonus resolves here — no cross-epoch carry. A bonus VESTS (is paid) unless the NFT was
 * listed/resold cheaper than the purchase price between the sale and this payout, in which case it is VOIDED
 * and its amount is added to the burn pot. Base buyer/seller rewards are always final.
 */
export function computeEpoch(
  sales: Sale[],
  signals: VestSignal[],
  epochStart: number,
  epochEnd: number,
  cfg: RewardConfig = DEFAULT_CONFIG,
  payoutAt: number = epochEnd,
): EpochResult {
  const buyerR = new Map<string, bigint>();
  const sellerR = new Map<string, bigint>();
  const bonusPay = new Map<string, bigint>();
  const bonuses: BonusOutcome[] = [];

  let artistMojos = Z;
  let burnMojos = Z;
  let totalRoyaltyMojos = Z;

  const add = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? Z) + v);

  for (const sale of sales) {
    const s = perSaleSlices(sale, cfg);
    totalRoyaltyMojos += sale.royaltyMojos;
    artistMojos += s.artist;
    burnMojos += s.burn;
    add(buyerR, sale.buyer, s.buyerReward);
    add(sellerR, sale.seller, s.sellerReward);

    if (sale.bonusWinner !== "none" && s.bonus > Z) {
      const winner = sale.bonusWinner === "buyer" ? sale.buyer : sale.seller;
      // Only the BUYER bonus vests/voids (spec §4). The SELLER premium bonus is final the instant the sale
      // confirms — never clawed back — so it is paid unconditionally (a buyer relisting cheap can't steal it).
      const void_ = sale.bonusWinner === "buyer" ? bonusVoided(sale.nftId, sale.priceMojos, sale.soldAt, payoutAt, signals) : null;
      if (void_) {
        burnMojos += s.bonus; // voided bonus feeds the burn
        bonuses.push({
          saleId: sale.id, nftId: sale.nftId, winner, side: sale.bonusWinner, amountMojos: s.bonus,
          status: "voided",
          reason: `${void_.kind} at ${fmtXch(void_.priceMojos)} < ${fmtXch(sale.priceMojos)} paid`,
        });
      } else {
        add(bonusPay, winner, s.bonus);
        bonuses.push({ saleId: sale.id, nftId: sale.nftId, winner, side: sale.bonusWinner, amountMojos: s.bonus, status: "paid" });
      }
    }
  }

  const wallets = new Set<string>([...buyerR.keys(), ...sellerR.keys(), ...bonusPay.keys()]);
  const payouts: WalletPayout[] = [];
  let rewardPotMojos = Z;
  for (const w of wallets) {
    const b = buyerR.get(w) ?? Z;
    const s = sellerR.get(w) ?? Z;
    const bo = bonusPay.get(w) ?? Z;
    const total = b + s + bo;
    rewardPotMojos += total;
    payouts.push({ wallet: w, buyerReward: b, sellerReward: s, bonus: bo, total });
  }
  payouts.sort((a, z) => (z.total > a.total ? 1 : z.total < a.total ? -1 : 0));

  const solvent = artistMojos + burnMojos + rewardPotMojos === totalRoyaltyMojos;

  return {
    epochStart, epochEnd,
    saleCount: sales.length,
    totalRoyaltyMojos, artistMojos, burnMojos, rewardPotMojos,
    payouts, bonuses, solvent,
  };
}

// Convert each wallet's owed XCH into $CHIA once the operator reports the ACTUAL $CHIA received for the whole
// reward pot. Slippage is shared proportionally (per the locked spec). Any rounding dust goes to the largest
// recipient so the sum equals chiaReceived exactly.
export function distributeChia(payouts: WalletPayout[], rewardPotMojos: bigint, chiaReceivedBaseUnits: bigint): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (rewardPotMojos <= Z || chiaReceivedBaseUnits <= Z) return out;
  let allocated = Z;
  let largest: string | null = null;
  let largestShare = BigInt(-1);
  for (const p of payouts) {
    const share = (p.total * chiaReceivedBaseUnits) / rewardPotMojos; // floor
    out.set(p.wallet, share);
    allocated += share;
    if (p.total > largestShare) { largestShare = p.total; largest = p.wallet; }
  }
  const dust = chiaReceivedBaseUnits - allocated;
  if (dust > Z && largest) out.set(largest, (out.get(largest) ?? Z) + dust);
  return out;
}
