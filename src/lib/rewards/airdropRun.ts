// Runnable GENESIS AIRDROP preview. Moves no funds; prints who WOULD get what from the one-time 100M $SNACKZ
// bucket, rarity-weighted, with project/mint wallets excluded. Prefer a FROZEN snapshot (--snapshot) so the
// preview matches exactly what the bot will send; without it, a live scan is used (drifts, preview only).
//   npx tsx src/lib/rewards/airdropRun.ts --snapshot ./airdrop-snapshot.json xch1proj…   # frozen (recommended)
//   npx tsx src/lib/rewards/airdropRun.ts xch1proj… xch1mint…                            # live scan (warns)
import { readFileSync } from "node:fs";
import { snapshotHolders } from "./allocatorLive";
import { MISFITZ_COLLECTION_ID } from "./detectLive";
import { MISFITZ_TOKEN, tokenStr } from "./token";
import { buildLaunchAirdrop, formatAirdropReport } from "./airdrop";
import { verifyFrozenSnapshot, type FrozenAirdropSnapshot } from "./airdropSnapshot";
import type { SnapshotNft } from "./allocator";

async function main() {
  const args = process.argv.slice(2);
  let snapPath: string | null = null;
  const excludeWallets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--snapshot") { snapPath = args[++i] ?? null; continue; }
    if (args[i]) excludeWallets.push(args[i]);
  }

  console.log(`=== ${MISFITZ_TOKEN.symbol} genesis airdrop preview ===`);
  console.log(`Bucket: ${tokenStr(MISFITZ_TOKEN.airdropUnits)} ${MISFITZ_TOKEN.symbol} (one-time launch airdrop)\n`);

  let holders: SnapshotNft[];
  if (snapPath) {
    const snap = JSON.parse(readFileSync(snapPath, "utf8")) as FrozenAirdropSnapshot;
    if (!verifyFrozenSnapshot(snap)) throw new Error(`frozen snapshot ${snapPath} failed hash verification — corrupt or tampered`);
    holders = snap.holders;
    console.log(`Frozen snapshot: ${snap.holderNftCount} holder-NFTs · hash ${snap.hash.slice(0, 16)}… · captured ${new Date(snap.capturedAt).toISOString()}\n`);
  } else {
    if (excludeWallets.length === 0) {
      console.log(`⚠  No exclude wallets given — your project/mint wallet WILL be counted. Re-run with your\n   holding wallet address(es) before trusting these numbers.\n`);
    }
    holders = await snapshotHolders(MISFITZ_COLLECTION_ID);
    console.log(`Live scan: ${holders.length} holder-NFTs (drifts — freeze with airdropFreeze.ts for the real run)\n`);
  }

  const r = buildLaunchAirdrop({ holders, airdropUnits: MISFITZ_TOKEN.airdropUnits, excludeWallets });
  console.log(formatAirdropReport(r, MISFITZ_TOKEN.symbol));
}
main().catch((e) => { console.error("airdrop preview failed:", e?.message ?? e); process.exit(1); });
