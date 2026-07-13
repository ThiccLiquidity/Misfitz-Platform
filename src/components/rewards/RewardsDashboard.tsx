"use client";

import { useEffect, useState } from "react";
import type { SnapshotDTO, OperatorSnapshotDTO, WalletLookupValue, TraderLeader, HolderLeader } from "@/lib/rewards/snapshotTypes";

// MisFitz Rewards - SHADOW dashboard (client). Imports ONLY the DTO types (type-only) - zero reward-engine code
// reaches the browser. Reads the cron-computed snapshot from the flag-gated /api/rewards/snapshot; never computes.
// Operator actions load separately from the authed /api/rewards/operator and render ONLY with ?ops=<secret>.

const mojosToXch = (s: string): number => { try { return Number(BigInt(s)) / 1e12; } catch { return 0; } };
const unitsToTok = (s: string): number => { try { return Number(BigInt(s)) / 1000; } catch { return 0; } };
const xch = (s: string, dp = 2) => mojosToXch(s).toLocaleString("en-US", { maximumFractionDigits: dp }) + " XCH";
const tok = (s: string, dp = 0) => unitsToTok(s).toLocaleString("en-US", { maximumFractionDigits: dp }) + " $TOKEN";

// Compact stat pill.
function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="text-subtle text-[10px] font-semibold uppercase tracking-[0.14em]">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${accent ?? "text-title"}`}>{value}</div>
      {sub && <div className="text-subtle mt-0.5 text-[11px]">{sub}</div>}
    </div>
  );
}

// Medal palette for the top three; everyone else gets a muted chip.
function medalStyle(rank: number): { chip: string; ring: string } {
  if (rank === 1) return { chip: "bg-amber-400 text-black", ring: "ring-2 ring-amber-400/70" };
  if (rank === 2) return { chip: "bg-slate-300 text-black", ring: "ring-2 ring-slate-300/60" };
  if (rank === 3) return { chip: "bg-orange-400 text-black", ring: "ring-2 ring-orange-400/60" };
  return { chip: "bg-white/10 text-white/70", ring: "" };
}

const PAL = ["#7F77DD", "#1D9E75", "#D85A30", "#378ADD", "#D4537E", "#BA7517", "#639922", "#5DCAA5", "#F0997B", "#AFA9EC"];

function LeaderRow({ rank, name, avatarUrl, walletTrunc, value }: { rank: number; name: string | null; avatarUrl: string | null; walletTrunc: string; value: string }) {
  const label = name || walletTrunc;
  const initial = (name || walletTrunc).replace(/^xch1|^did:chia:/, "").charAt(0).toUpperCase() || "?";
  const m = medalStyle(rank);
  return (
    <div className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors ${rank <= 3 ? "bg-white/[0.045]" : "hover:bg-white/[0.03]"}`}>
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black tabular-nums ${m.chip}`}>{rank}</div>
      {avatarUrl
        ? // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className={`h-9 w-9 shrink-0 rounded-full object-cover ${m.ring}`} loading="lazy" />
        : <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-black ${m.ring}`} style={{ background: PAL[rank % PAL.length] }}>{initial}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-title truncate text-sm font-semibold leading-tight">{label}</div>
        {name && <div className="text-subtle truncate text-[11px] leading-tight">{walletTrunc}</div>}
      </div>
      <div className="text-title shrink-0 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function Leaderboard({ title, tag, rows, empty }: { title: string; tag: string; rows: { key: string; name: string | null; avatarUrl: string | null; walletTrunc: string; value: string }[]; empty: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <div className="text-title text-sm font-bold">{title}</div>
        <div className="text-subtle text-[10px] font-semibold uppercase tracking-[0.14em]">{tag}</div>
      </div>
      {rows.length === 0
        ? <div className="text-subtle px-1 py-6 text-center text-sm">{empty}</div>
        : <div className="flex flex-col gap-0.5">{rows.map((r, i) => <LeaderRow key={r.key} rank={i + 1} name={r.name} avatarUrl={r.avatarUrl} walletTrunc={r.walletTrunc} value={r.value} />)}</div>}
    </div>
  );
}

// Operator-only panel: loads from the authed route using the ?ops key. Renders nothing for non-operators.
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
    <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">Operator actions &middot; you only</div>
      <div className="text-title mt-1 text-lg font-black tabular-nums">Send {xch(o.moveToHotWalletMojos)} to the hot wallet</div>
      <div className="text-subtle text-xs">
        &rarr; {xch(o.forRewardMojos)} to buy $CHIA (distribute) &middot; &rarr; {xch(o.forBurnMojos)} to buy &amp; burn $TOKEN &middot; keep {xch(o.keepArtistMojos)} (artist)
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
    <section className="mt-8 overflow-hidden rounded-3xl border border-amber-400/25 bg-amber-400/[0.04]">
      {/* Header band */}
      <div className="border-b border-amber-400/15 bg-amber-400/[0.06] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-title text-2xl font-black tracking-tight">MisFitz Rewards</h2>
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">Shadow Preview</span>
        </div>
        <p className="text-subtle mt-1 text-sm">
          Every MisFitz sale pays a 10% royalty &mdash; it flows right back to the community. <b className="text-title">Holders</b> earn
          monthly <b className="text-title">$TOKEN</b>, and <b className="text-title">traders</b> who buy &amp; sell earn <b className="text-title">$CHIA</b>.
        </p>
      </div>

      <div className="p-5 sm:p-6">
        {snap === "pending" ? (
          <div className="text-subtle py-8 text-center text-sm">Warming up this month&rsquo;s numbers…</div>
        ) : (
          <>
            {snap.meta.truncated && (
              <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                Still counting holders &mdash; the drip board is filling in.
              </div>
            )}

            {/* Headline stats */}
            <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="$TOKEN drip this month" value={tok(snap.drip.dripUnits)} accent="text-amber-300" sub={`${snap.drip.holderCount.toLocaleString()} holders`} />
              <Stat label="Royalties this month" value={xch(snap.trader.totalRoyaltyMojos)} sub={`${snap.trader.saleCount} sale${snap.trader.saleCount === 1 ? "" : "s"}`} />
              <Stat label="Reward pot → $CHIA" value={xch(snap.trader.rewardPotMojos)} sub={`${snap.trader.payoutCount} wallets`} />
              <Stat label="Burn pot → $TOKEN" value={xch(snap.trader.burnMojos)} sub={`${snap.trader.bonuses.voided} voided`} />
            </div>

            {/* Leaderboards - the fun part */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Leaderboard title="Top Holders" tag="$TOKEN drip" rows={holderRows} empty="Holder board is warming up…" />
              <Leaderboard title="Top Traders" tag="$CHIA earned" rows={traderRows} empty="No tracked sales yet this month." />
            </div>

            {/* Wallet lookup */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3.5">
              <div className="text-subtle mb-2 text-[10px] font-semibold uppercase tracking-[0.14em]">Check your wallet</div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={wallet} onChange={(e) => setWallet(e.target.value)}
                  placeholder="Paste xch1… or did:chia:…"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-amber-400/50 focus:outline-none"
                />
                <button type="button" onClick={doLookup} disabled={lookup.loading}
                  className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                  {lookup.loading ? "…" : "Look up"}
                </button>
              </div>
              {lookup.done && (
                <div className="mt-2.5 text-sm">
                  {lookup.value
                    ? <span className="text-title">You&rsquo;re earning <b className="tabular-nums text-amber-300">{tok(lookup.value.tokenUnits)}</b> &middot; trader rewards <b className="tabular-nums">{xch(lookup.value.traderTotalMojos)}</b> <span className="text-subtle">({lookup.value.nftCount} NFTs held)</span></span>
                    : <span className="text-subtle">No rewards found for that wallet this month.</span>}
                </div>
              )}
            </div>

            {/* Operator-only (renders nothing unless ?ops=<secret> resolves) */}
            {opsKey && <OperatorPanel colId={colId} opsKey={opsKey} />}

            {/* Fine print */}
            <p className="text-subtle mt-5 border-t border-white/10 pt-3 text-[11px] leading-relaxed">
              <b>Experimental community program.</b> A gift funded by the artist&rsquo;s royalty &mdash; not an investment, not a promise of
              payment, and not financial advice. Figures are estimates (they assume the 10% royalty was paid; not yet verified on-chain)
              and the program can change or end at any time as markets change.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
