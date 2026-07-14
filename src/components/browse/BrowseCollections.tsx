"use client";

import { useEffect, useState } from "react";
import type { CollectionSummary } from "@/types";
import { CollectionCard } from "./CollectionCard";
import { isTangEnabled, TANG_COLLECTION_COUNT, tangFor, TANG_DISCORD_URL } from "@/lib/tang/tang";
import { PpLogo } from "@/components/tang/PpLogo";

type Tab = "trending" | "tang";

// Discovery grid: trending collections by default, a Tang Gang tab (all Tang collections, most peel points
// first), and live search as you type (debounced) that overlays either tab. Styling carries the "Vault
// Floor" language: binder index tabs opening onto a page panel, a designed search pill, vault tiles.
export function BrowseCollections({ trending }: { trending: CollectionSummary[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("trending");
  const [tang, setTang] = useState<CollectionSummary[] | null>(null);
  const [tangSort, setTangSort] = useState<"pp" | "trending">("pp");
  const [tangLoading, setTangLoading] = useState(false);
  const tangOn = isTangEnabled();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/collections/search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { collections?: CollectionSummary[] } | null) => setResults(d?.collections ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Lazy-load the Tang set the first time the tab is opened.
  useEffect(() => {
    if (tab !== "tang" || tang) return;
    setTangLoading(true);
    fetch("/api/tang/collections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { collections?: CollectionSummary[] } | null) => setTang(d?.collections ?? []))
      .catch(() => setTang([]))
      .finally(() => setTangLoading(false));
  }, [tab, tang]);

  const tangList = tang
    ? [...tang].sort((a, b) => tangSort === "pp"
        ? (tangFor(b.id)?.pp ?? 0) - (tangFor(a.id)?.pp ?? 0)
        : (b.volumeXch ?? -1) - (a.volumeXch ?? -1))
    : [];
  const base = tab === "tang" ? tangList : trending;
  const showing = results ?? base;
  const baseLoading = tab === "tang" && tangLoading && !tang;
  // Heat marks the top-3 by volume, only on the trending tab with no active search.
  const heatTop = !results && tab === "trending";

  const body = (
    <>
      {tangOn && tab === "tang" && !results && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-subtle text-[11px] font-semibold uppercase tracking-widest">Sort</span>
          <button type="button" onClick={() => setTangSort("pp")} className={`tf-pill ${tangSort === "pp" ? "tf-pill--tang-active" : ""}`}>Most PP</button>
          <button type="button" onClick={() => setTangSort("trending")} className={`tf-pill ${tangSort === "trending" ? "tf-pill--tang-active" : ""}`}>Trending</button>
          <a href={TANG_DISCORD_URL} target="_blank" rel="noopener noreferrer" className="tf-discord-chip ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">Join the Tang Gang ↗</a>
        </div>
      )}

      <div className="relative mb-4 max-w-xl">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle">
          <svg aria-hidden viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" />
          </svg>
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collections…"
          spellCheck={false}
          className="tf-search w-full rounded-full py-3 pl-10 pr-4 text-base outline-none sm:text-sm"
        />
      </div>

      <div className="mb-3 flex items-center gap-2">
        {results ? (
          <span className="tf-eyebrow inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.16em]">Results · “{query.trim()}”</span>
        ) : tab === "tang" ? (
          <span className="tf-eyebrow tf-eyebrow--tang inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.16em]">
            <PpLogo size={13} /> Tang Gang · {tang ? showing.length : TANG_COLLECTION_COUNT} · {tangSort === "pp" ? "most PP" : "trending"}
          </span>
        ) : (
          <span className="tf-eyebrow inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.16em]">Trending · by volume</span>
        )}
        {(loading || baseLoading) && <span className="animate-pulse text-[11px] font-semibold normal-case" style={{ color: "var(--gold)" }}>loading…</span>}
      </div>

      {baseLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-4 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="tf-tile animate-pulse overflow-hidden">
              <div className="aspect-square" style={{ background: "var(--art-bg)" }} />
              <div className="tf-tile-foot space-y-2 p-3">
                <div className="h-3 w-2/3 rounded" style={{ background: "color-mix(in srgb, var(--gold) 15%, transparent)" }} />
                <div className="h-2.5 w-1/3 rounded" style={{ background: "color-mix(in srgb, var(--gold) 10%, transparent)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : showing.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center" style={{ borderColor: "color-mix(in srgb, var(--card-border) 45%, transparent)", background: "var(--card-bg)" }}>
          <div className="text-3xl opacity-40" style={{ color: "var(--gold)" }}>◈</div>
          <p className="text-subtle mt-2 text-sm">
            {results ? "No collections matched that search." : tab === "tang" ? "Couldn’t load Tang Gang collections right now." : "Couldn’t load collections right now."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-4 xl:grid-cols-6">
          {showing.map((c, i) => (
            <CollectionCard key={c.id} c={c} hot={heatTop && i < 3} />
          ))}
        </div>
      )}
    </>
  );

  if (!tangOn) return <div className="px-2">{body}</div>;

  return (
    <div className="px-2">
      <div className="tf-tabbar flex items-end gap-1">
        <button type="button" onClick={() => setTab("trending")} className={`tf-tab ${tab === "trending" ? "tf-tab--active" : ""}`}>
          All collections <span className="text-subtle font-semibold">· {trending.length}</span>
        </button>
        <button type="button" onClick={() => setTab("tang")} className={`tf-tab tf-tab--tang ${tab === "tang" ? "tf-tab--active" : ""}`}>
          <span className="inline-flex items-center gap-1.5"><PpLogo size={15} /> Tang Gang <span className="text-subtle font-semibold">· {TANG_COLLECTION_COUNT}</span></span>
        </button>
      </div>
      <div className="tf-tab-panel">{body}</div>
    </div>
  );
}
