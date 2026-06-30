"use client";

import { useEffect, useState } from "react";
import type { CollectionSummary } from "@/types";
import { CollectionCard } from "./CollectionCard";

// Discovery grid: trending collections by default, live search as you type (debounced).
export function BrowseCollections({ trending }: { trending: CollectionSummary[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CollectionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
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

  const showing = results ?? trending;

  return (
    <div className="px-2">
      <div className="relative mb-4 max-w-xl">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle">⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search collections…"
          spellCheck={false}
          className="text-title w-full rounded-lg border border-white/10 bg-white/[0.03] py-3 pl-9 pr-4 text-sm outline-none focus:border-emerald-400/40"
        />
      </div>

      <div className="text-subtle mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest">
        {results ? `Results for “${query.trim()}”` : "🔥 Trending collections"}
        {loading && <span className="text-violet-300/80 normal-case tracking-normal">searching…</span>}
      </div>

      {showing.length === 0 && !loading ? (
        <div className="text-subtle rounded-xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm">
          {results ? "No collections matched that search." : "Couldn’t load collections right now."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {showing.map((c) => (
            <CollectionCard key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
