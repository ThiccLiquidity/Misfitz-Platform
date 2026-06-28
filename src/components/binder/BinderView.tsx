"use client";

import { useMemo, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderPage } from "./BinderPage";
import { BinderPageControls } from "./BinderPageControls";
import { NftDetailModal } from "@/components/nft/NftDetailModal";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { getThemeTokens, themeTokensToCssVars } from "@/lib/theme/themes";

const PAGE_SIZE = 9;
const FLIP_DURATION_MS = 700;

interface BinderViewProps {
  collection: CollectionData;
  nfts: NftData[];
}

// The validated binder/flip mechanic (ARCHITECTURE.md §11), ported from the interactive
// prototype: 9-card 3x3 pages, a real 3D page flip that reveals the next page underneath
// (not a crossfade), trading-card proportions, and a center-open card detail with the binder
// blurred behind it. Collection-agnostic — only `collection`/`nfts` are collection-specific.
export function BinderView({ collection, nfts }: BinderViewProps) {
  const { mode } = useThemeMode();
  const tokens = getThemeTokens(mode, collection.theme);
  const cssVars = themeTokensToCssVars(tokens);

  const pages = useMemo(() => {
    const chunks: NftData[][] = [];
    for (let i = 0; i < nfts.length; i += PAGE_SIZE) {
      chunks.push(nfts.slice(i, i + PAGE_SIZE));
    }
    return chunks.length > 0 ? chunks : [[]];
  }, [nfts]);

  const [pageIndex, setPageIndex] = useState(0);
  const [backPageIndex, setBackPageIndex] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [openLauncherId, setOpenLauncherId] = useState<string | null>(null);

  const pageIndexRef = useRef(0);
  const animatingRef = useRef(false);
  const frontRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  function flipPage(direction: 1 | -1) {
    if (animatingRef.current || pages.length < 2) return;
    const front = frontRef.current;
    if (!front) return;

    animatingRef.current = true;
    setAnimating(true);

    const target = (pageIndexRef.current + direction + pages.length) % pages.length;
    setBackPageIndex(target);

    // Imperative, ref-driven transform/transition — kept out of React's style prop entirely so
    // re-renders (content swaps) never fight with mid-flight animation state. See ARCHITECTURE.md
    // §11 for why every wrapper in this chain needs transform-style: preserve-3d.
    front.style.transformOrigin = direction > 0 ? "left center" : "right center";
    front.style.transition = "transform 0.7s cubic-bezier(.45,0,.2,1)";
    front.style.transform = `rotateY(${direction > 0 ? -180 : 180}deg)`;

    setTimeout(() => {
      pageIndexRef.current = target;
      setPageIndex(target);
      front.style.transition = "none";
      front.style.transform = "rotateY(0deg)";
      // Force a synchronous reflow so the instant reset above is committed before we re-enable
      // the transition below — otherwise the browser can coalesce the two and animate the reset.
      void front.offsetHeight;
      requestAnimationFrame(() => {
        front.style.transition = "transform 0.7s cubic-bezier(.45,0,.2,1)";
        animatingRef.current = false;
        setAnimating(false);
      });
    }, FLIP_DURATION_MS);
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartXRef.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    if (Math.abs(dx) > 40) flipPage(dx < 0 ? 1 : -1);
    touchStartXRef.current = null;
  }

  const openNft = openLauncherId ? nfts.find((n) => n.launcherId === openLauncherId) ?? null : null;

  return (
    <div
      style={cssVars as CSSProperties}
      className="rounded-2xl bg-vault-bg p-4 md:p-8"
    >
      <div className={openNft ? "blur-sm transition" : "transition"}>
        <div
          className="relative mx-auto w-full max-w-2xl"
          style={{ perspective: "1400px" }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative" style={{ transformStyle: "preserve-3d" }}>
            <div
              className="absolute inset-0 z-[1] rounded-xl border-2 border-page-border bg-page-bg"
            >
              <BinderPage nfts={pages[backPageIndex] ?? []} onOpen={setOpenLauncherId} />
            </div>
            <div
              ref={frontRef}
              className="relative z-[2] h-full rounded-xl border-2 border-page-border bg-page-bg"
              style={{ transformStyle: "preserve-3d", backfaceVisibility: "hidden" }}
            >
              <BinderPage nfts={pages[pageIndex] ?? []} onOpen={setOpenLauncherId} />
            </div>
          </div>
        </div>

        <BinderPageControls
          pageIndex={pageIndex}
          pageCount={pages.length}
          onPrev={() => flipPage(-1)}
          onNext={() => flipPage(1)}
          disabled={animating}
        />
      </div>

      {openNft && <NftDetailModal nft={openNft} onClose={() => setOpenLauncherId(null)} />}
    </div>
  );
}
