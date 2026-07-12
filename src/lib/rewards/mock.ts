// Mock builders for tests + the shadow demo. NOT used by the live app.
import { type BonusWinner, type Sale, type VestSignal } from "./types";

// XCH (up to 6dp) -> mojos, without floating error at test scales.
export function xch(n: number): bigint {
  return BigInt(Math.round(n * 1_000_000)) * BigInt(1_000_000);
}

export function mkSale(o: {
  id: string; nftId: string; buyer: string; seller: string; priceXch: number;
  bonusWinner?: BonusWinner; soldAt?: number; royaltyBps?: number;
}): Sale {
  const priceMojos = xch(o.priceXch);
  const royaltyMojos = (priceMojos * BigInt(o.royaltyBps ?? 1000)) / BigInt(10000);
  return {
    id: o.id, nftId: o.nftId, buyer: o.buyer, seller: o.seller,
    priceMojos, royaltyMojos, bonusWinner: o.bonusWinner ?? "none", soldAt: o.soldAt ?? 0,
  };
}

export function mkSignal(nftId: string, priceXch: number, at: number, kind: "list" | "sale" = "list"): VestSignal {
  return { nftId, priceMojos: xch(priceXch), at, kind };
}

// A small, realistic sample month for the shadow demo: mix of fair / buyer-bonus / seller-bonus, a wallet
// that both buys and sells, and one buyer who dumps cheap (bonus should void).
export function sampleMonth(): { sales: Sale[]; signals: VestSignal[]; epochStart: number; epochEnd: number } {
  const D = 24 * 60 * 60 * 1000;
  const start = 0;
  const end = 30 * D;
  const sales: Sale[] = [
    mkSale({ id: "s1", nftId: "nftA", buyer: "alice", seller: "bob",   priceXch: 100, bonusWinner: "buyer",  soldAt: 2 * D }),
    mkSale({ id: "s2", nftId: "nftB", buyer: "bob",   seller: "carol", priceXch: 40,  bonusWinner: "none",   soldAt: 5 * D }),
    mkSale({ id: "s3", nftId: "nftC", buyer: "dave",  seller: "alice", priceXch: 250, bonusWinner: "seller", soldAt: 9 * D }),
    mkSale({ id: "s4", nftId: "nftD", buyer: "erin",  seller: "dave",  priceXch: 12,  bonusWinner: "buyer",  soldAt: 20 * D }),
  ];
  const signals: VestSignal[] = [
    // Erin bought nftD at 12 then relisted at 9 (cheaper) -> her buyer bonus voids.
    mkSignal("nftD", 9, 22 * D, "list"),
  ];
  return { sales, signals, epochStart: start, epochEnd: end };
}
