"use client";

import { useEffect, useState } from "react";
import type { SnapshotDTO, WalletLookupValue } from "@/lib/rewards/snapshotTypes";

// MisFitz Rewards — SHADOW dashboard (client). Imports ONLY the DTO types (type-only) — zero reward-engine code
// reaches the browser. Reads the cron-computed snapshot from the flag-gated /api/rewards/snapshot; never computes.
// Everything is labeled a SHADOW estimate. Only rendered when the server flag is on (see collection page).

const mojosToXch = (s: string): number => { try { return Number(BigInt(s)) / 1e12; } catch { return 0; } };
const unitsToTok = (s: string): number => { try { return Number(BigInt(s)) / 1000; } catch { return 0; } };
const xch = (s: string, dp = 2) => mojosToXch(s).toLocaleString("en-US", { maximumFractionDigits: dp }) + " XCH";
const tok = (s: string, dp = 0) => unitsToTok(s).toLocaleString("en-US", { maximumFractionDigits: dp }) + " $TOKEN";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-subtle text-[11px] uppercase tracking-widest">{label}</div>
      <div className="text-title mt-0.5 text-lg font-bold tabular-nums">{value}</div>
      {sub && <div className="text-subtle text-xs">{sub}</div>}
    </div>
  );
}

export function RewardsDashboard({ colId }: { colId: string }) {
  const [snap, setSnap] = useState<SnapshotDTO | "pending" | null>(null);
  const [wallet, setWallet] = useState("");
  const [lookup, setLookup] = useState<{ loading: boolean; value: WalletLookupValue | null; done: boolean }>({ loading: false, value: null, done: false });

  useEffect(() => {
    let alive = true;
    fetch(`/api/rewards/snapshot?col=${encodeURIComponent(colId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!alive) return; setSnap(d && "trader" in d ? (d as SnapshotDTO) : "pending"); })
      .catch(() => alive && setSnap(null));
    return () => { alive = false; };
  }, [colId]);

  if (snap === null) return null; // flag off / route 404 / error -> render nothing
  const doLookup = async () => {
    const w = wallet.trim().toLowerCase();
    if (!w) return;
    setLookup({ loading: true, value: null, done: false });
    try {
      const r = await fetch(`/api/rewards/lookup?col=${encodeURIComponent(colId)}&wallet=${encodeURIComponent(w)}`);
      const d = await r.json();
      setLookup({ loading: false, value: (d?.value ?? null) as WalletLookupValue | null, done: true });
    } catch { setLookup({ loading: false, value: null, done: true }); }
  };

  return (
    <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-title text-xl font-black">MisFitz Rewards</h2>
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">SHADOW PREVIEW</span>
      </div>
      <p className="text-subtle mb-4 text-xs">
        Estimated figures — assumes the 10% royalty was paid (not yet verified on-chain). <b>Not a promise of payment.</b>{" "}
        {snap === "pending" ? "Computing this month's snapshot…" : snap.status === "mtd" ? "Month-to-date running estimate; bonuses may still vest or void." : "Final for the month."}
      </p>

      {snap !== "pending" && (
        <>
          {snap.meta.truncated && (
            <div className="mb-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              Holder snapshot is incomplete (roster still warming) — drip figures are partial.
            </div>
          )}

          {/* Trader rewards */}
          <div className="text-subtle mb-2 text-[11px] font-bold uppercase tracking-widest">Traders — {snap.trader.saleCount} sale{snap.trader.saleCount === 1 ? "" : "s"}</div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Royalties in" value={xch(snap.trader.totalRoyaltyMojos)} />
            <Stat label="Reward pot → $CHIA" value={xch(snap.trader.rewardPotMojos)} sub={`${snap.trader.payoutCount} wallets`} />
            <Stat label="Burn pot → $TOKEN" value={xch(snap.trader.burnMojos)} sub={`${snap.trader.bonuses.voided} voided → burn`} />
            <Stat label="Artist (1%)" value={xch(snap.trader.artistMojos)} />
          </div>

          {/* Holder drip */}
          <div className="text-subtle mb-2 text-[11px] font-bold uppercase tracking-widest">Holders — monthly $TOKEN drip</div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Drip this month" value={tok(snap.drip.dripUnits)} />
            <Stat label="Holders" value={snap.drip.holderCount.toLocaleString()} sub={`${snap.drip.nftCount.toLocaleString()} NFTs`} />
            <Stat label="Unattributed → burn" value={String(snap.meta.unattributedCount)} sub="rewards we couldn't verify" />
          </div>

          {/* Operator panel */}
          <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
            <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">Operator actions (end of month)</div>
            <div className="text-title mt-1 text-lg font-black tabular-nums">Send {xch(snap.operator.moveToHotWalletMojos)} to the hot wallet</div>
            <div className="text-subtle text-xs">
              → {xch(snap.operator.forRewardMojos)} to buy $CHIA (distribute) · → {xch(snap.operator.forBurnMojos)} to buy &amp; burn $TOKEN · keep {xch(snap.operator.keepArtistMojos)} (artist)
            </div>
          </div>

          {/* Wallet lookup */}
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-subtle mb-1.5 text-[11px] font-bold uppercase tracking-widest">Check a wallet</div>
            <div className="flex flex-wrap gap-2">
              <input
                value={wallet} onChange={(e) => setWallet(e.target.value)}
                placeholder="xch1… or did:chia:…"
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-white/30"
              />
              <button type="button" onClick={doLookup} disabled={lookup.loading}
                className="rounded-lg bg-amber-400/90 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                {lookup.loading ? "…" : "Look up"}
              </button>
            </div>
            {lookup.done && (
              <div className="mt-2 text-sm">
                {lookup.value
                  ? <span className="text-title">Est. drip <b className="tabular-nums">{tok(lookup.value.tokenUnits)}</b> · trader rewards <b className="tabular-nums">{xch(lookup.value.traderTotalMojos)}</b> ({lookup.value.nftCount} NFTs held)</span>
                  : <span className="text-subtle">No rewards found for that wallet this month.</span>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
