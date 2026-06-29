import type { CollectionData } from "@/types";

// Server component — light mode styles driven by globals.css [data-theme="light"] .ch-* rules.
export function CollectionHeader({ collection }: { collection: CollectionData }) {
  const accent = collection.theme?.accent ?? "#2980c8";

  return (
    <div
      className="collection-header rounded-2xl mb-3 px-6 py-6 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${accent}12 0%, var(--page-bg, #fff) 55%, ${accent}08 100%)`,
        border: `1px solid ${accent}28`,
        boxShadow: `0 4px 20px ${accent}10`,
      }}
    >
      {/* ── Light mode: decorative sky elements ───────────────────────── */}
      <div className="ch-sun" />
      <div className="ch-cloud ch-cloud-a" />
      <div className="ch-cloud ch-cloud-b" />
      <div className="ch-cloud ch-cloud-c" />

      {/* Accent left-edge stripe */}
      <div
        className="ch-stripe absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ background: `linear-gradient(180deg, ${accent} 0%, ${accent}80 100%)` }}
      />

      {/* ── Content: centered ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center justify-center text-center relative z-10 gap-3">

        {/* Big fat collection name */}
        <h1
          className="ch-title font-black leading-none"
          style={{
            fontSize: "clamp(2.8rem, 6vw, 4.5rem)",
            letterSpacing: "-0.01em",
            color: "var(--title)",
          }}
        >
          {collection.name}
        </h1>

        {/* Subtitle row: BINDER badge + separator + NFT count */}
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <span
            className="ch-badge px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-widest text-white"
            style={{ background: accent }}
          >
            BINDER
          </span>

          <span
            className="ch-count-dot"
            style={{ color: "var(--subtle)", fontSize: 12 }}
          >
            ·
          </span>

          <div className="flex items-baseline gap-1.5">
            <span
              className="ch-count font-black tabular-nums"
              style={{ fontSize: 22, color: accent }}
            >
              {collection.nftCount.toLocaleString()}
            </span>
            <span
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "var(--subtle)" }}
            >
              Total NFTs
            </span>
          </div>
        </div>

        {/* Optional description */}
        {collection.description && (
          <p
            className="ch-desc text-sm font-medium max-w-lg"
            style={{ color: "var(--subtle)" }}
          >
            {collection.description}
          </p>
        )}

      </div>
    </div>
  );
}
