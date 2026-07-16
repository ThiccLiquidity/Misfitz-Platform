// $CHIPS payout bot — CONFIG (operator machine). Loaded from a JSON file (path via --config or ./bot-config.json)
// with env-var overrides. Holds NO private keys. Assets are bound PER KIND so a tampered manifest can't cross
// them (a "drip" can never pay $CHIA). The ops secret authorises manifest download + receipts (sent as a Bearer
// header, never a URL param).
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { CHIA_ASSET_ID, TOKEN_TAIL_TBD } from "./manifest";

export interface BotConfig {
  siteUrl: string;
  opsSecret: string;
  ledgerPath: string;           // resolved absolute (against the CONFIG file's dir, not the cwd)
  chiaAssetId: string;          // $CHIA reward CAT
  chipsAssetId: string;         // $CHIPS tail (TOKEN_TAIL_TBD until minted)
  allowedAssets: string[];      // DERIVED: the assets the bot may send (never the placeholder)
  assetForKind: { reward: string; drip: string }; // DERIVED: binds kind -> its only permitted asset
  fundingCapUnits: string;      // hard per-run total cap (base units) — MANDATORY, stricter than the manifest
  maxSends: number;
  confirmTimeoutMs: number;
  feeMojos: string;             // network fee per send (0 risks slow/unconfirmed; set a small nonzero for live)
  // sage.fingerprint = the WALLET PIN: the key fingerprint of the DESIGNATED distribution wallet. Sage's RPC
  // spends from whatever key is logged in, so before (and during) every live run the bot probes Sage's active
  // fingerprint and HALTS unless it equals this value. MANDATORY for a live send — with it unset the CLI
  // refuses, so the bot can never spend from a personal/royalty wallet you left open. See BOT-CONTRACT.md.
  sage: { rpcUrl: string; apiKey?: string; fingerprint?: string };
  requireSignature: boolean;    // v1: false (hash-only). Flip true only once a REAL verifier is wired (see botCli).
}

interface RawConfig {
  siteUrl?: string; opsSecret?: string; ledgerPath?: string;
  chiaAssetId?: string; chipsAssetId?: string;
  fundingCapUnits?: string; maxSends?: number; confirmTimeoutMs?: number; feeMojos?: string;
  sage?: { rpcUrl?: string; apiKey?: string; fingerprint?: string | number }; requireSignature?: boolean;
}

export function loadConfig(configPath = "./bot-config.json"): BotConfig {
  let raw: RawConfig = {};
  if (existsSync(configPath)) {
    try { raw = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig; }
    catch { throw new Error(`bot config at ${configPath} is not valid JSON`); }
  }
  const chiaAssetId = raw.chiaAssetId || CHIA_ASSET_ID;
  const chipsAssetId = raw.chipsAssetId || TOKEN_TAIL_TBD;
  const allowedAssets = [chiaAssetId, chipsAssetId].filter((a) => a && a !== TOKEN_TAIL_TBD);
  const rawLedger = raw.ledgerPath || "./bot-ledger.json";
  const ledgerPath = isAbsolute(rawLedger) ? rawLedger : resolve(dirname(resolve(configPath)), rawLedger);

  return {
    siteUrl: process.env.TRAITFOLIO_SITE_URL ?? raw.siteUrl ?? "http://localhost:3000",
    opsSecret: process.env.REWARDS_OPS_SECRET ?? raw.opsSecret ?? "",
    ledgerPath,
    chiaAssetId,
    chipsAssetId,
    allowedAssets,
    assetForKind: { reward: chiaAssetId, drip: chipsAssetId },
    fundingCapUnits: raw.fundingCapUnits ?? "0",
    maxSends: raw.maxSends ?? 500,
    confirmTimeoutMs: raw.confirmTimeoutMs ?? 180_000,
    feeMojos: raw.feeMojos ?? "0",
    sage: {
      rpcUrl: raw.sage?.rpcUrl ?? "http://localhost:9257",
      apiKey: raw.sage?.apiKey,
      // Accept number or string in the JSON (fingerprints are u32s; people paste both) but pin as a string.
      // Deliberately NO env override: the pin lives only in the config file next to the ledger.
      fingerprint: raw.sage?.fingerprint != null && String(raw.sage.fingerprint).trim() !== "" ? String(raw.sage.fingerprint).trim() : undefined,
    },
    requireSignature: raw.requireSignature ?? false,
  };
}
