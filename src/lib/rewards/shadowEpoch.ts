// MisFitz Rewards — FULL end-to-end SHADOW epoch on live MisFitz data. One command prints the whole monthly
// picture and moves ZERO funds:
//   traders:  detect sales -> engine -> settle unattributed -> operator plan -> reward manifest (hash)
//   holders:  token supply -> month drip -> snapshot -> allocate -> drip manifest (hash)
// Usage:  npx tsx src/lib/rewards/shadowEpoch.ts [YYYY-MM] [dripMonthN]
//   npx tsx src/lib/rewards/shadowEpoch.ts 2026-06 1
//   npx tsx src/lib/rewards/shadowEpoch.ts            # last 30 days, drip month 1
import { runShadowEpoch, MISFITZ_COLLECTION_ID } from "./detectLive";
import { settleUnattributed } from "./settle";
import { distributeChia } from "./engine";
import { buildRewardManifest, buildDripManifest, formatManifest } from "./manifest";
import { verifyManifest } from "./manifestGuard";
import { formatEpochReport, formatDripReport, formatTokenReport } from "./report";
import { MISFITZ_TOKEN, dripForMonth, tokenStr } from "./token";
import { runDripPreview } from "./allocatorLive";
import { CHIA_ASSET_ID, TOKEN_TAIL_TBD } from "./manifest";

function monthWindow(ym?: string): { start: number; end: number; id: string } {
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const [y, m] = ym.split("-").map(Number);
    const start = Date.UTC(y, m - 1, 1);
    const end = Date.UTC(y, m, 1);
    return { start, end, id: ym };
  }
  const end = Date.now();
  return { start: end - 30 * 24 * 60 * 60_000, end, id: "last30d" };
}

async function main() {
  const { start, end, id } = monthWindow(process.argv[2]);
  const dripMonth = Number(process.argv[3] ?? "1");
  const now = Date.now();

  console.log(`\n########## MisFitz Rewards — SHADOW epoch ${id} ##########`);
  console.log(`window ${new Date(start).toISOString()} .. ${new Date(end).toISOString()}  (no funds moved)\n`);

  // ---- Trader side ----
  const epoch = await runShadowEpoch(MISFITZ_COLLECTION_ID, start, end);
  console.log(formatEpochReport(epoch));

  const settlement = settleUnattributed(epoch);
  console.log(`\n--- Settlement (unattributed -> burn) ---`);
  console.log(`verified reward pot: ${settlement.verifiedRewardPotMojos} mojos · routed to burn: ${settlement.routedToBurnMojos} mojos · placeholders dropped: ${settlement.droppedRecipients}`);

  // Reward manifest — $CHIA units are PROVISIONAL (1:1 placeholder; real amounts come from the monthly buy).
  const provisionalChia = distributeChia(settlement.payable, settlement.verifiedRewardPotMojos, settlement.verifiedRewardPotMojos);
  const rewardManifest = buildRewardManifest(id, settlement.payable, provisionalChia, now, settlement.routedToBurnMojos);
  console.log(`\n--- Reward manifest ($CHIA, PROVISIONAL 1:1 units) ---`);
  console.log(formatManifest(rewardManifest, 8));
  const rv = verifyManifest(rewardManifest, { allowedAssets: [CHIA_ASSET_ID], fundingCapUnits: settlement.verifiedRewardPotMojos });
  console.log(`verify: ${rv.ok ? "OK" : "FAIL " + rv.errors.join("; ")}${rv.warnings.length ? " · warnings: " + rv.warnings.join("; ") : ""}`);

  // ---- Holder side ----
  console.log(`\n${formatTokenReport(MISFITZ_TOKEN, dripMonth)}`);
  const { drip } = dripForMonth(MISFITZ_TOKEN.dripPoolUnits, dripMonth, MISFITZ_TOKEN.dripRateBps);
  console.log(`\n--- Drip allocation (month ${dripMonth}: ${tokenStr(drip)} ${MISFITZ_TOKEN.symbol}) ---`);
  const dripResult = await runDripPreview(MISFITZ_COLLECTION_ID, drip);
  console.log(formatDripReport(dripResult, MISFITZ_TOKEN.symbol));
  const dripManifest = buildDripManifest(id, dripResult, now, { symbol: MISFITZ_TOKEN.symbol, assetId: TOKEN_TAIL_TBD });
  console.log(`\ndrip manifest hash ${dripManifest.hash} · recipients ${dripManifest.recipientCount} · total ${tokenStr(BigInt(dripManifest.totalUnits))} ${MISFITZ_TOKEN.symbol}`);
  const dv = verifyManifest(dripManifest, { allowedAssets: [TOKEN_TAIL_TBD], allowPlaceholderAsset: true });
  console.log(`verify: ${dv.ok ? "OK" : "FAIL " + dv.errors.join("; ")}`);
  console.log(`\n########## end shadow epoch ${id} ##########\n`);
}
main().catch((e) => { console.error("shadow epoch failed:", e?.message ?? e); process.exit(1); });
