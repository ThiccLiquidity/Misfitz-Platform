"use client";

import { useEffect, useState } from "react";
import type { SnapshotDTO, OperatorSnapshotDTO, WalletLookupValue, TraderLeader, HolderLeader } from "@/lib/rewards/snapshotTypes";

// MisFitz Rewards — SHADOW dashboard (client). Imports ONLY the DTO types (type-only) — zero reward-engine code
// reaches the browser. Reads the cron-computed snapshot from the flag-gated /api/rewards/snapshot; never computes.
// Operator actions are NOT in the public snapshot — they load separately from the authed /api/rewards/operator
// and render ONLY when an operator opens the page with ?ops=<secret>. Everything is labeled a SHADOW estimate.

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

// One leaderboard row: rank medal, avatar (or initial fallback), name/handle (or truncated wallet), value.
function LeaderRow({ rank, name, avatarUrl, walletTrunc, value }: { rank: number; name: string | null; avatarUrl: string | null; walletTrunc: string; value: string }) {
  const medal = rank === 1 ? "text-amber-300" : rank === 2 ? "text-slate-300" : rank === 3 ? "text-orange-400" : "text-subtle";
  const label = name || walletTrunc;
  const initial = (name || walletTrunc).replace(/^xch1|^did:chia:/, "").charAt(0).toUpperCase() || "?";
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
      <div className={`w-5 shrink-0 text-center text-sm font-black tabular-nums ${medal}`}>{rank}</div>
      {avatarUrl
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" loading="lazy" />
        : <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white/70">{initial}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-title truncate text-sm font-semibold">{label}</div>
        {name && <div className="text-subtle truncate text-[11px]">{walletTrunc}</div>}
      </div>
      <div className="text-title shrink-0 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Leaderboard({ title, rows }: { title: string; rows: { key: string; name: string | null; avatarUrl: string | null; walletTrunc: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-subtle mb-1.5 text-[11px] font-bold uppercase tracking-widest">{title}</div>
      {rows.length === 0
        ? <div className="text-subtle px-2 py-3 text-sm">No entries yet this month.</div>
        : <div className="flex flex-col">{rows.map((r, i) => <LeaderRow key={r.key} rank={i + 1} name={r.name} avatarUrl={r.avatarUrl} walletTrunc={r.walletTrunc} value={r.value} />)}</div>}
    </div>
  );
}

// Operator-only panel: loads the operator actions from the authed route using the ?ops key the operator supplied.
// Renders nothing for non-operators (no key -> no fetch; a wrong key -> route 404 -> nothing).
function OperatorPanel({ colId, opsKey }: { colId: string; opsKey: string }) {
  const [ops, setOps] = useState<OperatorSnapshotDTO | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/rewards/operator?col=${encodeURIComponent(colId)}`, { headers: { authorization: `Bearer ${opsKey}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && "operator" in d) setOps(d as OperatorSnapshotDTO); })
      .catch(() => {});
    return () => { alive = false; };
  }, [colId, opsKey]);
  if (!ops) return null;
  const o = ops.operator;
  return (
    <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">Operator actions (end of month · you only)</div>
      <div className="text-title mt-1 text-lg font-black tabular-nums">Send {xch(o.moveToHotWalletMojos)} to the hot wallet</div>
      <div className="text-subtle text-xs">
        → {xch(o.forRewardMojos)} to buy $CHIA (distribute) · → {xch(o.forBurnMojos)} to buy &amp; burn $TOKEN · keep {xch(o.keepArtistMojos)} (artist)
      </div>
    </div>
  );
}

export function RewardsDashboard({ colId, opsKey }: { colId: string; opsKey?: string }) {
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

  const holderRows = snap !== "pending"
    ? snap.drip.topHolders.map((h: HolderLeader, i) => ({ key: `${h.walletTrunc}:${i}`, name: h.name, avatarUrl: h.avatarUrl, walletTrunc: h.walletTrunc, value: tok(h.tokenUnits) }))
    : [];
  const traderRows = snap !== "pending"
    ? snap.trader.topPayouts.map((t: TraderLeader, i) => ({ key: `${t.walletTrunc}:${i}`, name: t.name, avatarUrl: t.avatarUrl, walletTrunc: t.walletTrunc, value: xch(t.total) }))
    : [];

  return (
    <div className="mb-6 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-title text-xl font-black">MisFitz Rewards</h2>
        <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">SHADOW PREVIEW</span>
      </div>
      <p className="text-subtle mb-4 text-xs">
        <b>Experimental community program.</b> MisFitz Rewards is a <b>gift funded by the artist&rsquo;s royalty</b> — not an
        investment, not a promise of payment, and not financial advice. Figures are estimates that assume the 10% royalty
        was paid (not yet verified on-chain); the program can change or end at any time as markets change.{" "}
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
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Royalties in" value={xch(snap.trader.totalRoyaltyMojos)} />
            <Stat label="Reward pot → $CHIA" value={xch(snap.trader.rewardPotMojos)} sub={`${snap.trader.payoutCount} wallets`} />
            <Stat label="Burn pot → $TOKEN" value={xch(snap.trader.burnMojos)} sub={`${snap.trader.bonuses.voided} voided → burn`} />
          </div>

          {/* Holder drip */}
          <div className="text-subtle mb-2 text-[11px] font-bold uppercase tracking-widest">Holders — monthly $TOKEN drip</div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Drip this month" value={tok(snap.drip.dripUnits)} />
            <Stat label="Holders" value={snap.drip.holderCount.toLocaleString()} sub={`${snap.drip.nftCount.toLocaleString()} NFTs`} />
            <Stat label="Unattributed → burn" value={String(snap.meta.unattributedCount)} sub="rewards we couldn't verify" />
          </div>

          {/* Leaderboards */}
          <div className="text-subtle mb-2 text-[11px] font-bold uppercase tracking-widest">Leaderboards</div>
          <div className="mb-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Leaderboard title="Top holders · $TOKEN drip" rows={holderRows} />
            <Leaderboard title="Top traders · $CHIA rewards" rows={traderRows} />
          </div>

          {/* Wallet lookup */}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
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

          {/* Operator-only (renders nothing unless ?ops=<secret> resolves) */}
          {opsKey && <OperatorPanel colId={colId} opsKey={opsKey} />}
        </>
      )}
    </div>
  );
}
