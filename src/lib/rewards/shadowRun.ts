// Runnable SHADOW epoch on real MisFitz data. Moves no funds; prints what the engine WOULD owe.
//   npx tsx src/lib/rewards/shadowRun.ts            # last 30 days
//   npx tsx src/lib/rewards/shadowRun.ts 2026-06-01 2026-07-01
// Requires the app env (Dexie/MintGarden reachable; comps optional). Report is stamped UNVERIFIED.
import { runShadowEpoch, MISFITZ_COLLECTION_ID } from "./detectLive";
import { formatEpochReport } from "./report";

async function main() {
  const [a, b] = process.argv.slice(2);
  const end = b ? Date.parse(b) : Date.now();
  const start = a ? Date.parse(a) : end - 30 * 24 * 60 * 60_000;
  console.log(`Shadow epoch — MisFitz — ${new Date(start).toISOString()} .. ${new Date(end).toISOString()}\n`);
  const r = await runShadowEpoch(MISFITZ_COLLECTION_ID, start, end);
  console.log(formatEpochReport(r));
  console.log(`\nsolvent=${r.solvent} saleCount=${r.saleCount} wallets=${r.payouts.length}`);
}
main().catch((e) => { console.error("shadow run failed:", e?.message ?? e); process.exit(1); });
