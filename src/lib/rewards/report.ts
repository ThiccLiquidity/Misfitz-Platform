// Pure formatter for an epoch result — reused by the shadow-mode CLI, the epoch report, and (later) the
// dashboard. No I/O.
import { type EpochResult } from "./types";
import { xchStr } from "./format";
import { operatorPlanFromSettlement } from "./operator";
import { settleUnattributed } from "./settle";
import { type DripResult } from "./allocator";
import { type TokenConfig, circulating, cumulativeDrip, dripForMonth, tokenStr } from "./token";

export function formatEpochReport(r: EpochResult): string {
  const L: string[] = [];
  L.push(`=== MisFitz Rewards — Epoch report ===`);
  L.push(`SHADOW MODE — assumes 10% royalty paid per sale (UNVERIFIED). No funds moved. On-chain royalty + counterparty verification required before any real payout.`);
  L.push(`Sales counted:   ${r.saleCount}`);
  L.push(`Royalties in:    ${xchStr(r.totalRoyaltyMojos)} XCH`);
  L.push(`  Artist (1%):   ${xchStr(r.artistMojos)} XCH`);
  L.push(`  Reward pot:    ${xchStr(r.rewardPotMojos)} XCH  -> buy $CHIA, distribute`);
  L.push(`  Burn pot:      ${xchStr(r.burnMojos)} XCH  -> buy & burn $TOKEN`);
  L.push(`Solvent:         ${r.solvent ? "YES (allocated === received)" : "NO — BUG"}`);
  L.push(``);
  const plan = operatorPlanFromSettlement(r, settleUnattributed(r));
  L.push(`=== Operator actions (do BEFORE distribution — nothing is auto-sent) ===`);
  L.push(`SEND TO HOT WALLET:  ${xchStr(plan.moveToHotWalletMojos)} XCH   (from the royalty wallet, then swap)`);
  L.push(`  -> ${xchStr(plan.forRewardMojos)} XCH  swap to $CHIA  -> distribute to the wallets below`);
  L.push(`  -> ${xchStr(plan.forBurnMojos)} XCH  swap to $TOKEN -> burn`);
  L.push(`KEEP in royalty wallet (your 1% artist cut): ${xchStr(plan.keepArtistMojos)} XCH`);
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

// Human-readable $TOKEN drip report — who gets how much of this month's holder drip. Snapshot is fixed-date
// (1st of month); listed NFTs still count; rarity-weighted per NFT. No funds moved — the operator executes
// the sends from the manifest.
export function formatDripReport(r: DripResult, tokenSymbol = "$TOKEN"): string {
  const L: string[] = [];
  L.push(`=== MisFitz Rewards — Monthly ${tokenSymbol} drip ===`);
  L.push(`SHADOW — snapshot: fixed 1st-of-month · listed NFTs count · rarity-weighted per NFT. No funds moved.`);
  L.push(`Drip this month: ${r.dripUnits.toString()} ${tokenSymbol} units`);
  L.push(`Holders:         ${r.holderCount}   (${r.nftCount} NFTs)`);
  L.push(`Solvent:         ${r.solvent ? "YES (allocated === drip)" : "NO — BUG"}`);
  L.push(``);
  L.push(`Top allocations:`);
  for (const w of r.wallets.slice(0, 15)) {
    L.push(`  ${w.wallet.padEnd(12)} ${w.tokenUnits.toString().padStart(14)} ${tokenSymbol}   (${w.nftCount} NFT${w.nftCount === 1 ? "" : "s"}, weight ${w.weight.toFixed(2)})`);
  }
  return L.join("\n");
}

// $TOKEN supply snapshot for the operator/dashboard. monthsElapsed + burnedUnits let it show the live picture.
export function formatTokenReport(c: TokenConfig, monthsElapsed = 0, burnedUnits: bigint = BigInt(0)): string {
  const pct = (u: bigint) => `${(Number((u * BigInt(10000)) / c.totalSupplyUnits) / 100).toFixed(1)}%`;
  const L: string[] = [];
  L.push(`=== ${c.symbol} supply (SHADOW — TAIL not minted, no funds) ===`);
  L.push(`Total supply:  ${tokenStr(c.totalSupplyUnits)} ${c.symbol}`);
  L.push(`  Airdrop:     ${tokenStr(c.airdropUnits)}  (${pct(c.airdropUnits)})`);
  L.push(`  Drip pool:   ${tokenStr(c.dripPoolUnits)}  (${pct(c.dripPoolUnits)})  @ ${c.dripRateBps / 100}%/mo geometric`);
  L.push(`  LP seed:     ${tokenStr(c.lpSeedUnits)}  (${pct(c.lpSeedUnits)})`);
  L.push(`  LP rewards:  ${tokenStr(c.lpRewardUnits)}  (${pct(c.lpRewardUnits)})  tenure-escalating LP airdrop`);
  L.push(`  Team:        ${tokenStr(c.teamUnits)}  (${pct(c.teamUnits)})`);
  const thisMonth = dripForMonth(c.dripPoolUnits, monthsElapsed, c.dripRateBps).drip;
  const circ = circulating(c, monthsElapsed, burnedUnits);
  L.push(``);
  L.push(`After ${monthsElapsed} month(s):`);
  L.push(`  Drip this month:   ${tokenStr(thisMonth)} ${c.symbol}`);
  L.push(`  Dripped to date:   ${tokenStr(cumulativeDrip(c.dripPoolUnits, monthsElapsed, c.dripRateBps))}`);
  L.push(`  Burned to date:    ${tokenStr(burnedUnits)}`);
  L.push(`  Circulating:       ${tokenStr(circ.circulatingUnits)}`);
  L.push(`  Drip reserve left: ${tokenStr(circ.dripRemainingUnits)}`);
  return L.join("\n");
}
