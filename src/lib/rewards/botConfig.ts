// $CHIPS payout bot — CONFIG (operator machine). Loaded from a JSON file (path via --config or ./bot-config.json)
// with env-var overrides. Holds NO private keys — only the Sage RPC endpoint + the asset whitelist + caps. The
// server ops secret is used to download the manifest and post receipts back to the dashboard.
import { existsSync, readFileSync } from "node:fs";
import { CHIA_ASSET_ID, TOKEN_TAIL_TBD } from "./manifest";

export interface BotConfig {
  siteUrl: string;              // e.g. https://traitfolio.app — where /api/rewards/manifest + /receipts live
  opsSecret: string;            // REWARDS_OPS_SECRET (authorises manifest download + receipts post)
  ledgerPath: string;           // idempotency ledger file (default ./bot-ledger.json)
  allowedAssets: string[];      // asset ids the bot may send ($CHIA + $CHIPS tail once minted)
  fundingCapUnits: string;      // hard per-run total cap (base units) — MANDATORY, stricter than the manifest
  maxSends: number;             // absolute per-run recipient cap
  confirmTimeoutMs: number;     // waitConfirmed budget per send
  sage: { rpcUrl: string; apiKey?: string };  // Sage wallet local RPC (live send only)
  requireSignature: boolean;    // v1: false (hash-only). Flip true once the server signs manifests.
}

const DEFAULTS: BotConfig = {
  siteUrl: "http://localhost:3000",
  opsSecret: "",
  ledgerPath: "./bot-ledger.json",
  allowedAssets: [CHIA_ASSET_ID],           // $CHIPS tail added here once minted (never the TOKEN_TAIL_TBD placeholder)
  fundingCapUnits: "0",                      // must be set to a real cap before a live send
  maxSends: 500,
  confirmTimeoutMs: 180_000,
  sage: { rpcUrl: "http://localhost:9257" },
  requireSignature: false,
};

export function loadConfig(path = "./bot-config.json"): BotConfig {
  let file: Partial<BotConfig> = {};
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, "utf8")) as Partial<BotConfig>; }
    catch { throw new Error(`bot config at ${path} is not valid JSON`); }
  }
  const cfg: BotConfig = {
    ...DEFAULTS,
    ...file,
    sage: { ...DEFAULTS.sage, ...(file.sage ?? {}) },
    // env overrides (never put secrets in the JSON if you can pass env)
    siteUrl: process.env.TRAITFOLIO_SITE_URL ?? file.siteUrl ?? DEFAULTS.siteUrl,
    opsSecret: process.env.REWARDS_OPS_SECRET ?? file.opsSecret ?? DEFAULTS.opsSecret,
  };
  // Guard against ever whitelisting the placeholder tail.
  cfg.allowedAssets = cfg.allowedAssets.filter((a) => a && a !== TOKEN_TAIL_TBD);
  return cfg;
}
