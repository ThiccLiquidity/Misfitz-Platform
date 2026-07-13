// Runnable $TOKEN drip PREVIEW on the live MisFitz holder snapshot. Moves no funds; prints who would get what.
//   npx tsx src/lib/rewards/dripRun.ts        # month 1 drip
//   npx tsx src/lib/rewards/dripRun.ts 6      # month 6 drip
import { snapshotHolders, runDripPreview } from "./allocatorLive";
import { formatDripReport, formatTokenReport } from "./report";
import { MISFITZ_COLLECTION_ID } from "./detectLive";
import { MISFITZ_TOKEN, dripForMonth, tokenStr } from "./token";

async function main() {
  const month = Number(process.argv[2] ?? "1");
  const { drip } = dripForMonth(MISFITZ_TOKEN.dripPoolUnits, month, MISFITZ_TOKEN.dripRateBps);
  console.log(formatTokenReport(MISFITZ_TOKEN, month));
  console.log(`\nMonth ${month} drip = ${tokenStr(drip)} ${MISFITZ_TOKEN.symbol} — allocating across current holders:\n`);
  const snap = await snapshotHolders(MISFITZ_COLLECTION_ID);
  console.log(`Holder snapshot: ${snap.length} NFTs with owners\n`);
  const r = await runDripPreview(MISFITZ_COLLECTION_ID, drip);
  console.log(formatDripReport(r, MISFITZ_TOKEN.symbol));
}
main().catch((e) => { console.error("drip run failed:", e?.message ?? e); process.exit(1); });
