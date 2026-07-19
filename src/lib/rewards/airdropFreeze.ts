// FREEZE the genesis-airdrop holder snapshot. Run ONCE, on launch day, after Misfitz is fully distributed.
// Fresh full scan -> hashed immutable file. The preview + send then run against THIS file (never a re-scan).
//   npx tsx src/lib/rewards/airdropFreeze.ts                 # -> ./airdrop-snapshot.json
//   npx tsx src/lib/rewards/airdropFreeze.ts ./my-snap.json  # custom path
import { writeFileSync } from "node:fs";
import { snapshotHolders } from "./allocatorLive";
import { MISFITZ_COLLECTION_ID } from "./detectLive";
import { freezeAirdropSnapshot } from "./airdropSnapshot";

async function main() {
  const out = process.argv[2] || "./airdrop-snapshot.json";
  console.log("Scanning current Misfitz holders (fresh full scan)…");
  const holders = await snapshotHolders(MISFITZ_COLLECTION_ID);
  const snap = freezeAirdropSnapshot(MISFITZ_COLLECTION_ID, holders);
  writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(`Frozen ${snap.holderNftCount} holder-NFTs -> ${out}`);
  console.log(`hash:       ${snap.hash}`);
  console.log(`capturedAt: ${new Date(snap.capturedAt).toISOString()}`);
  console.log(`\nPreview against this frozen roster (add your project wallet(s) to exclude):`);
  console.log(`  npx tsx src/lib/rewards/airdropRun.ts --snapshot ${out} <xch1-project-wallet…>`);
}
main().catch((e) => { console.error("freeze failed:", e?.message ?? e); process.exit(1); });
