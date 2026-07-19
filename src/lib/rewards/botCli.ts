/* $SNACKZ payout bot — operator CLI (runs on YOUR machine; holds no keys).
 *
 *   npm run bot -- preview  --epoch 2026-06                 # dry-run: download the settlement doc, print what
 *                                                           # would move/pay. Sends nothing. No wallet needed.
 *   npm run bot -- send     --epoch 2026-06 --kind drip --expect-hash <hash>   # LIVE: verify -> type SEND -> pay
 *   npm run bot -- send     --epoch 2026-06 --kind drip --dry                  # dry-run of the exact send list
 *   npm run bot -- send     --file reward-2026-06.json [--dry]                 # pay a finalized reward manifest
 *   npm run bot -- receipts --epoch 2026-06 --kind drip    # re-post receipts from the ledger (dashboard stuck un-paid)
 *
 * Flags: --config <path>, --col <id>, --site <url>, --new-ledger (genuine first run only).
 * v1: manual swap, HASH-ONLY trust, $SNACKZ not minted (drips guard-blocked until its tail is in the config).
 */
import { readFileSync } from "node:fs";
import { loadConfig, type BotConfig } from "./botConfig";
import { FileLedgerStore } from "./botLedger";
import { SageWallet } from "./botSage";
import { TerminalConfirmGate } from "./botGate";
import { runBotPayout, summarizePayout } from "./bot";
import { verifyManifest, pendingRecipients } from "./manifestGuard";
import { formatManifest, type PayoutManifest } from "./manifest";
import type { SettlementDoc } from "./settlementDoc";
import type { BotDeps, BotOpts } from "./botDeps";

const MOJOS = 1_000_000_000_000;
const xch = (mojos: string | number) => (Number(BigInt(mojos)) / MOJOS).toFixed(4);

function parseFlags(a: string[]): Record<string, string | boolean> {
  const f: Record<string, string | boolean> = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : true;
    f[k] = v;
  }
  return f;
}
const authHeaders = (cfg: BotConfig): Record<string, string> => (cfg.opsSecret ? { authorization: `Bearer ${cfg.opsSecret}` } : {});

async function getDoc(cfg: BotConfig, epoch: string, col?: string): Promise<SettlementDoc> {
  const u = new URL(`${cfg.siteUrl.replace(/\/$/, "")}/api/rewards/manifest`);
  u.searchParams.set("epoch", epoch);
  if (col) u.searchParams.set("col", col);
  const res = await fetch(u.toString(), { headers: authHeaders(cfg) }); // Bearer — never the secret in the URL
  if (!res.ok) throw new Error(`manifest download failed: HTTP ${res.status} (check --site / ops secret / that the epoch is CLOSED)`);
  const j = (await res.json()) as Record<string, unknown>;
  if (!j || typeof j !== "object" || !("move" in j)) {
    const st = typeof j?.status === "string" ? j.status : "unknown";
    const dt = typeof j?.detail === "string" ? ` — ${j.detail}` : "";
    throw new Error(`epoch not ready: ${st}${dt} (close the epoch first, and make sure it is FINAL)`);
  }
  const doc = j as unknown as SettlementDoc;
  if (doc.epochId !== epoch) throw new Error(`server returned epoch ${doc.epochId}, expected ${epoch} — refusing`);
  return doc;
}

function printPreview(doc: SettlementDoc, cfg: BotConfig): void {
  console.log(`\n=== Settlement · ${doc.collectionId.slice(0, 12)}… · epoch ${doc.epochId} [${doc.status}] ===`);
  console.log(`\n1) MOVE to your fresh distribution wallet, then swap:`);
  console.log(`   total:               ${xch(doc.move.toDistributionWalletMojos)} XCH`);
  console.log(`     ├─ swap -> $CHIA:   ${xch(doc.move.swapToChiaForRewardsMojos)} XCH   (buy $CHIA, then split to traders)`);
  console.log(`     └─ buy&burn $SNACKZ: ${xch(doc.move.buyTokenForBurnMojos)} XCH`);
  console.log(`   artist cut (keep):    ${xch(doc.move.artistCutMojos)} XCH   (stays as XCH in your royalty wallet)`);
  console.log(`\n2) $SNACKZ DRIP (from treasury, deterministic):`);
  console.log(`   ${doc.drip.tokenUnits} units to ${doc.drip.holderCount} holders${doc.drip.tokenMinted ? "" : "  [PLACEHOLDER tail — will NOT send until $SNACKZ is minted + whitelisted]"}`);
  const dv = verifyManifest(doc.drip.manifest, { allowedAssets: [doc.drip.manifest.asset.id], allowPlaceholderAsset: true });
  console.log(`   ${dv.ok ? "internally consistent" : "PROBLEMS: " + dv.errors.join("; ")}`);
  console.log(formatManifest(doc.drip.manifest, 5).split("\n").map((l) => "   " + l).join("\n"));
  console.log(`\n   >> to pay this drip:  npm run bot -- send --epoch ${doc.epochId} --kind drip --expect-hash ${doc.drip.manifest.hash}`);
  console.log(`\n3) $CHIA REWARD table (pre-swap XCH owed — finalize after you enter the received $CHIA):`);
  console.log(`   verified pot ${xch(doc.rewards.payoutPotMojos)} XCH · routed to burn ${xch(doc.rewards.routedToBurnMojos)} XCH · ${doc.rewards.wallets.length} recipients`);
  for (const w of doc.rewards.wallets.slice(0, 5)) console.log(`     ${w.wallet.padEnd(16)} owed ${xch(w.owedMojos)} XCH`);
  if (doc.rewards.wallets.length > 5) console.log(`     … +${doc.rewards.wallets.length - 5} more`);
  console.log(`\n   recipient-list hash ${doc.recipientListHash}`);
  console.log(`\n(dry-run — nothing sent. allowedAssets: ${cfg.allowedAssets.join(", ") || "(none — drips blocked until $SNACKZ minted)"} )\n`);
}

async function postReceipts(cfg: BotConfig, col: string, epoch: string, kind: "reward" | "drip", sent: { assetId: string; amountUnits: string; txId: string }[]): Promise<boolean> {
  if (sent.length === 0) return true;
  const total = sent.reduce((s, r) => s + BigInt(r.amountUnits), BigInt(0)).toString();
  const u = new URL(`${cfg.siteUrl.replace(/\/$/, "")}/api/rewards/receipts`);
  const receipts = sent.map((r) => ({ kind, txId: r.txId, recipientCount: 1, totalUnits: r.amountUnits, assetId: r.assetId, at: Date.now() }));
  receipts.unshift({ kind, txId: `batch:${epoch}:${kind}:${Date.now()}`, recipientCount: sent.length, totalUnits: total, assetId: sent[0].assetId, at: Date.now() });
  try {
    const res = await fetch(u.toString(), { method: "POST", headers: { "content-type": "application/json", ...authHeaders(cfg) }, body: JSON.stringify({ col, epoch, receipts }) });
    if (res.ok) { console.log(`receipts posted (${sent.length} tx) — dashboard marked paid`); return true; }
    console.log(`WARN: receipts post failed HTTP ${res.status} — payments went out; re-run 'receipts' later`); return false;
  } catch (e) { console.log(`WARN: receipts post errored (${(e as Error)?.message}) — payments went out; re-run 'receipts' later`); return false; }
}

async function doSend(cfg: BotConfig, manifest: PayoutManifest, col: string, epoch: string, live: boolean, allowCreate: boolean): Promise<void> {
  if (cfg.requireSignature) throw new Error("requireSignature=true but no real signature verifier is wired in botCli — implement operator-pubkey verification before flipping this flag (do NOT go live with a stub verifier)");
  if (BigInt(cfg.fundingCapUnits) <= BigInt(0)) throw new Error("config.fundingCapUnits is 0 — set a real hard cap (base units) before a live send");
  // WALLET PIN: a live send is refused outright until the designated distribution wallet's fingerprint is
  // pinned in the config; the orchestrator + Sage adapter then HALT unless Sage's active key matches it.
  if (live && !cfg.sage.fingerprint) throw new Error("config.sage.fingerprint is not set — pin the DESIGNATED distribution wallet's fingerprint before a live send (open Sage on that wallet, copy its fingerprint; see BOT-CONTRACT.md 'Wallet isolation')");
  const kind = manifest.kind; // "reward" | "drip"
  const store = new FileLedgerStore(cfg.ledgerPath, { allowCreate });
  const deps: BotDeps = {
    wallet: new SageWallet({ ...cfg.sage, feeMojos: cfg.feeMojos }),
    store,
    gate: new TerminalConfirmGate(),
    verifySig: () => { throw new Error("unreachable: allowUnsigned is set in hash-only v1"); },
  };
  const opts: BotOpts = {
    allowedAssets: cfg.allowedAssets,
    fundingCapUnits: BigInt(cfg.fundingCapUnits),
    maxSends: cfg.maxSends,
    confirmTimeoutMs: cfg.confirmTimeoutMs,
    allowUnsigned: !cfg.requireSignature,
    expectedKind: kind,
    expectedAssetId: cfg.assetForKind[kind],
    requireWalletPreflight: true, // the wallet-pin guard must EXIST — a WalletRpc without preflight() halts
  };
  if (!live) {
    const { pending } = pendingRecipients(manifest, await store.load());
    const vr = verifyManifest(manifest, { allowedAssets: opts.allowedAssets, kind, fundingCapUnits: opts.fundingCapUnits, allowPlaceholderAsset: true });
    console.log(summarizePayout(manifest, pending, manifest.recipients.length - pending.length, vr.errors.concat(vr.warnings)));
    console.log("\n(--dry set — nothing sent)");
    return;
  }
  const r = await runBotPayout(manifest, deps, opts);
  console.log(`\nresult: ${r.status}${r.haltReason ? ` — ${r.haltReason}` : ""}  ·  sent ${r.sent.length} · already-paid ${r.skippedAlreadyPaid}`);
  if (r.sent.length) await postReceipts(cfg, col, epoch, kind, r.sent.map((s) => ({ assetId: s.assetId, amountUnits: s.amountUnits, txId: s.txId })));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = parseFlags(argv.slice(1));
  const cfg = loadConfig(typeof flags.config === "string" ? flags.config : "./bot-config.json");
  if (typeof flags.site === "string") cfg.siteUrl = flags.site;
  const col = typeof flags.col === "string" ? flags.col : undefined;
  const epoch = typeof flags.epoch === "string" ? flags.epoch : undefined;
  const live = !("dry" in flags);                 // --dry (presence) forces a no-send preview
  const allowCreate = "new-ledger" in flags;

  if (cmd === "preview") {
    if (!epoch) throw new Error("preview needs --epoch YYYY-MM");
    printPreview(await getDoc(cfg, epoch, col), cfg);
    return;
  }

  if (cmd === "send") {
    let manifest: PayoutManifest, colId = col ?? "", ep = epoch ?? "";
    if (typeof flags.file === "string") {
      manifest = JSON.parse(readFileSync(flags.file, "utf8")) as PayoutManifest; // operator-finalized reward manifest
      ep = manifest.epochId; colId = manifest.collectionId ?? colId;
    } else {
      if (!epoch) throw new Error("send needs --epoch YYYY-MM (or --file manifest.json)");
      if (flags.kind !== "drip" && flags.kind !== "reward") throw new Error("send needs --kind drip|reward (no default — be explicit)");
      if (flags.kind === "reward") throw new Error("reward send needs a finalized manifest via --file (build it AFTER your manual swap — see BOT-CONTRACT.md)");
      const doc = await getDoc(cfg, epoch, col);
      colId = doc.collectionId;
      manifest = doc.drip.manifest;
      // Pin the manifest to what you previewed — defends against a server/transport swap between preview and send.
      if (live && flags["expect-hash"] !== manifest.hash) {
        throw new Error(`--expect-hash required and must match. Got ${flags["expect-hash"] || "(none)"}, manifest is ${manifest.hash}. Run 'preview' and copy the hash it prints.`);
      }
    }
    await doSend(cfg, manifest, colId, ep, live, allowCreate);
    return;
  }

  if (cmd === "receipts") {
    // Re-post receipts from the ledger's confirmed sends (dashboard stuck un-paid after a receipts-post failure).
    if (!epoch) throw new Error("receipts needs --epoch YYYY-MM");
    const kind = flags.kind === "reward" ? "reward" : "drip";
    const store = new FileLedgerStore(cfg.ledgerPath, { allowCreate });
    const ledger = await store.load();
    const sent: { assetId: string; amountUnits: string; txId: string }[] = [];
    for (const [key, amountUnits] of ledger) {
      let parsed: unknown[]; try { parsed = JSON.parse(key) as unknown[]; } catch { continue; }
      const [kCol, kEpoch, kKind, kAsset] = parsed as [string, string, string, string];
      if (kEpoch === epoch && kKind === kind && (!col || kCol === col)) sent.push({ assetId: kAsset, amountUnits, txId: "ledger" });
    }
    if (sent.length === 0) { console.log("no confirmed payments in the ledger for that epoch/kind"); return; }
    await postReceipts(cfg, col ?? "", epoch, kind, sent);
    return;
  }

  console.log("usage:\n  npm run bot -- preview  --epoch YYYY-MM [--col <id>]\n  npm run bot -- send     --epoch YYYY-MM --kind drip --expect-hash <hash> [--dry] [--new-ledger]\n  npm run bot -- send     --file <manifest.json> [--dry]\n  npm run bot -- receipts --epoch YYYY-MM --kind drip");
}

main().catch((e) => { console.error("\nbot error:", (e as Error)?.message ?? e); process.exit(1); });
