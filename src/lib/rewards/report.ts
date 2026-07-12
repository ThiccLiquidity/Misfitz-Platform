// Pure formatter for an epoch result — reused by the shadow-mode CLI, the epoch report, and (later) the
// dashboard. No I/O.
import { type EpochResult } from "./types";
import { xchStr } from "./format";

export function formatEpochReport(r: EpochResult): string {
  const L: string[] = [];
  L.push(`=== MisFitz Rewards — Epoch report ===`);
  L.push(`Sales counted:   ${r.saleCount}`);
  L.push(`Royalties in:    ${xchStr(r.totalRoyaltyMojos)} XCH`);
  L.push(`  Artist (1%):   ${xchStr(r.artistMojos)} XCH`);
  L.push(`  Reward pot:    ${xchStr(r.rewardPotMojos)} XCH  -> buy $CHIA, distribute`);
  L.push(`  Burn pot:      ${xchStr(r.burnMojos)} XCH  -> buy & burn $TOKEN`);
  L.push(`Solvent:         ${r.solvent ? "YES (allocated === received)" : "NO — BUG"}`);
  L.push(``);
  L.push(`Top payouts (XCH owed, before $CHIA conversion):`);
  for (const p of r.payouts.slice(0, 10)) {
    L.push(`  ${p.wallet.padEnd(10)} ${xchStr(p.total).padStart(10)}   (buy ${xchStr(p.buyerReward)}, sell ${xchStr(p.sellerReward)}, bonus ${xchStr(p.bonus)})`);
  }
  const voided = r.bonuses.filter((b) => b.status === "voided");
  if (voided.length) {
    L.push(``);
    L.push(`Voided bonuses (-> burn):`);
    for (const b of voided) L.push(`  ${b.winner} lost ${xchStr(b.amountMojos)} XCH on ${b.nftId} — ${b.reason}`);
  }
  return L.join("\n");
}
