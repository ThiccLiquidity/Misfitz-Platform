"use client";

import { useMemo, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import type { CollectionData, NftData } from "@/types";
import { BinderPage } from "./BinderPage";
import { BinderPageControls } from "./BinderPageControls";
import { NftDetailModal } from "@/components/nft/NftDetailModal";
import { NftRarityCard } from "@/components/nft/NftRarityCard";
import { useThemeMode } from "@/components/theme/ThemeProvider";
import { getThemeTokens, themeTokensToCssVars } from "@/lib/theme/themes";

const PAGE_SIZE = 9;           // 3×3 grid per page — matches physical binder reference
const FLIP_DURATION_MS = 700;

interface BinderViewProps {
  collection: CollectionData;
  nfts: NftData[];
  // Live NFTs (wallet / live collection) have no on-platform detail page yet, so hide the modal's
  // "View Full Page" link (it would 404 against the DB-only /collections/[slug]/nfts route).
  hideFullPageLink?: boolean;
  // Grid path (phones/tablets): reveal more cards when paging past the last loaded page.
  onNeedMore?: () => void;
  hasMore?: boolean;
  // Portfolio context: the modal shows the "view this collection" link (with a leave-warning) and the
  // "what to list at for each badge" coach. Off on the collection page (you don't list someone else's NFT).
  fromPortfolio?: boolean; // portfolio-only affordances
}

// Two-page spread binder with a CSS 3D page-flip mechanic (approved prototype §11).
//
// Visual slot diagram:
//   ┌──────────────┬────┬──────────────────────────────────────────────┐
//   │  LEFT PAGE   │    │              RIGHT AREA (z-2 → z-100)        │
//   │  (static,    │    │  ┌────────────────────────────────────────┐  │
//   │   z-1)       │    │  │ UNDERLAY (z-0, absolute)               │  │
//   │              │    │  │  — pre-loaded next-right content       │  │
//   │  pages       │    │  │  — shows through as flipper lifts      │  │
//   │  [leftIdx]   │    │  ├────────────────────────────────────────┤  │
//   │              │SPINE│  │ FLIPPER (z-1, preserve-3d)            │  │
//   │              │(z-3)│  │  FRONT FACE: pages[frontIdx]          │  │
//   │              │    │  │  BACK  FACE: pages[backIdx]            │  │
//   └──────────────┴────┴──────────────────────────────────────────────┘
//
// Spread mapping (spread n): left = pages[n*2], right = pages[n*2+1]
//
// z-index: spine(3) > right-area(2) > flipper(1) > underlay(0)
// During animation: right-area raised to z-100 so flipper passes OVER spine rings.
export function BinderView({ collection, nfts, hideFullPageLink = false, onNeedMore, hasMore = false, fromPortfolio = false }: BinderViewProps) {
  const { mode } = useThemeMode();
  const tokens = getThemeTokens(mode, collection.theme);
  const cssVars = themeTokensToCssVars(tokens);

  // Chunk NFTs into pages of 9.
  const pages = useMemo(() => {
    const chunks: NftData[][] = [];
    for (let i = 0; i < nfts.length; i += PAGE_SIZE) chunks.push(nfts.slice(i, i + PAGE_SIZE));
    return chunks.length > 0 ? chunks : [[]];
  }, [nfts]);

  const spreadCount = Math.ceil(pages.length / 2);

  // Independent page-index for each visual slot. Decoupling them lets us pre-load
  // back/underlay before the animation starts, then snap left/front after.
  const [leftIdx,     setLeftIdx]     = useState(0);
  const [frontIdx,    setFrontIdx]    = useState(1);
  const [backIdx,     setBackIdx]     = useState(2);   // back face (pre-loaded next-left)
  const [underlayIdx, setUnderlayIdx] = useState(3);   // underlay (pre-loaded next-right)

  const [displaySpread, setDisplaySpread] = useState(0); // drives BinderPageControls text
  const [animating,     setAnimating]     = useState(false);
  const [openLauncherId, setOpenLauncherId] = useState<string | null>(null);

  const openNft = openLauncherId
    ? nfts.find((n) => n.launcherId === openLauncherId) ?? null
    : null;

  const spreadRef    = useRef(0);          // shadow of displaySpread safe to read in closures
  const animatingRef = useRef(false);
  const flipperRef   = useRef<HTMLDivElement | null>(null);
  const rightAreaRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  // Grid path (phones/tablets): page through a fixed number of cards instead of endless scroll.
  const GRID_SIZE = 12;
  const [gridPage, setGridPage] = useState(0);
  const gridTotal = Math.max(1, Math.ceil(nfts.length / GRID_SIZE));
  const gp = Math.min(gridPage, gridTotal - 1);
  const gridSlice = nfts.slice(gp * GRID_SIZE, gp * GRID_SIZE + GRID_SIZE);
  const gridFlip = (dir: 1 | -1) => {
    if (dir > 0) { if (gp < gridTotal - 1) setGridPage(gp + 1); else if (hasMore) { onNeedMore?.(); setGridPage(gp + 1); } }
    else setGridPage(Math.max(0, gp - 1));
  };
  const touchStartXMobileRef = useRef<number | null>(null);
  function handleMobileTouchStart(e: TouchEvent) { touchStartXMobileRef.current = e.touches[0].clientX; }
  function handleMobileTouchEnd(e: TouchEvent) {
    if (touchStartXMobileRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXMobileRef.current;
    if (Math.abs(dx) > 40) gridFlip(dx < 0 ? 1 : -1);
    touchStartXMobileRef.current = null;
  }

  function flipSpread(direction: 1 | -1) {
    if (animatingRef.current) return;
    const flipper   = flipperRef.current;
    const rightArea = rightAreaRef.current;
    if (!flipper || !rightArea) return;

    const nextSpread = spreadRef.current + direction;
    if (nextSpread < 0 || nextSpread >= spreadCount) return;

    animatingRef.current = true;
    setAnimating(true);
    rightArea.style.zIndex = "100"; // raise above spine rings for the duration

    if (direction > 0) {
      // ── FORWARD FLIP ───────────────────────────────────────────────────────
      // Pre-load is already in place (set at end of last flip's cleanup).
      // back = next-left, underlay = next-right → their content shows as the page lifts.

      flipper.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(.4,0,.2,1)`;
      flipper.style.transform  = "rotateY(-180deg)";

      setTimeout(() => {
        setLeftIdx(nextSpread * 2);       // left page = what back face just revealed
        setFrontIdx(nextSpread * 2 + 1);  // front face = new right page

        // Instant reset: no transition, no visible snap.
        flipper.style.transition = "none";
        flipper.style.transform  = "rotateY(0deg)";
        void flipper.offsetHeight;        // force reflow before transition re-enables

        // Pre-load for the NEXT forward flip.
        const ns2 = nextSpread + 1;
        setBackIdx(   ns2 < spreadCount ? ns2 * 2     : nextSpread * 2);
        setUnderlayIdx(ns2 < spreadCount ? ns2 * 2 + 1 : nextSpread * 2 + 1);

        spreadRef.current = nextSpread;
        setDisplaySpread(nextSpread);
        rightArea.style.zIndex = "2";
        animatingRef.current   = false;
        setAnimating(false);
      }, FLIP_DURATION_MS);

    } else {
      // ── BACKWARD FLIP ──────────────────────────────────────────────────────
      // Back face will show the previous right page at -180 (the "incoming" page).
      setBackIdx(   nextSpread * 2 + 1);
      setUnderlayIdx(nextSpread * 2 + 1); // underlay matches so no content change is visible

      // Left page updates immediately — it will be visible as the flipper sweeps right.
      setLeftIdx(nextSpread * 2);

      // Double RAF: let React flush setBackIdx / setLeftIdx re-renders BEFORE snapping
      // the flipper to -180. Without this the back face briefly shows stale content.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Front face won't be visible at -180 (it's on the "away" side), so it's
          // safe to set it now — it will be correct when the animation reaches 0.
          setFrontIdx(nextSpread * 2 + 1);

          // Snap flipper to -180 with no transition (back face now faces the user).
          flipper.style.transition = "none";
          flipper.style.transform  = "rotateY(-180deg)";
          void flipper.offsetHeight;

          // Animate to 0: back face sweeps out, front face emerges on the right.
          flipper.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(.4,0,.2,1)`;
          flipper.style.transform  = "rotateY(0deg)";

          setTimeout(() => {
            // Pre-load for the next potential forward flip from this spread.
            const ns2 = nextSpread + 1;
            setBackIdx(   ns2 < spreadCount ? ns2 * 2     : nextSpread * 2);
            setUnderlayIdx(ns2 < spreadCount ? ns2 * 2 + 1 : nextSpread * 2 + 1);

            spreadRef.current = nextSpread;
            setDisplaySpread(nextSpread);
            rightArea.style.zIndex = "2";
            animatingRef.current   = false;
            setAnimating(false);
          }, FLIP_DURATION_MS);
        });
      });
    }
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartXRef.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e: TouchEvent) {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    if (Math.abs(dx) > 40) flipSpread(dx < 0 ? 1 : -1);
    touchStartXRef.current = null;
  }

  return (
    <div>
    <div style={cssVars as CSSProperties} className="tcg-binder-shell rounded-2xl p-2 md:p-3">
      <div className={openNft ? "blur-sm transition" : "transition"}>

        {/* ── SPREAD ──────────────────────────────────────────────────────────── */}
        <div
          className="relative hidden w-full xl:block"
          style={{ perspective: "1100px" }}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mx-auto flex w-full items-stretch" style={{ height: "clamp(480px, 72vh, 860px)", maxWidth: "calc(clamp(480px, 72vh, 860px) * 1.43 + 48px)" }}>

            {/* LEFT PAGE — static, not part of the 3D rig; hidden on mobile */}
            <div className="hidden md:flex flex-1 min-w-0 relative z-[1]">
              <BinderPage
                nfts={pages[leftIdx] ?? []}
                collectionName={collection.name}
                onOpen={setOpenLauncherId}
                totalSupply={collection.totalSupply}
                rarityTiers={collection.rarityTiers}
                side="left"
              />
            </div>

            {/* SPINE — 4 metallic binder rings. z-3 so pages sit below at rest (z-2) but
                the flipper, riding in right-area at z-100, passes over during animation. */}
            <div
              className="hidden md:flex w-12 flex-col justify-evenly items-center flex-shrink-0 relative z-[3]"
              style={mode === "light" ? {
                background: "linear-gradient(90deg, #0a2040 0%, #1a3f70 25%, #102e58 50%, #1a3f70 75%, #0a2040 100%)",
                boxShadow:
                  "inset 4px 0 12px rgba(0,20,60,0.5), inset -4px 0 12px rgba(0,20,60,0.5), " +
                  "3px 0 14px rgba(0,20,60,0.3), -3px 0 14px rgba(0,20,60,0.3)",
              } : {
                background: "linear-gradient(90deg, #0e0e11 0%, #25252d 25%, #1e1e26 50%, #25252d 75%, #0e0e11 100%)",
                boxShadow:
                  "inset 4px 0 12px rgba(0,0,0,0.6), inset -4px 0 12px rgba(0,0,0,0.6), " +
                  "3px 0 14px rgba(0,0,0,0.5), -3px 0 14px rgba(0,0,0,0.5)",
              }}
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="relative flex items-center justify-center"
                  style={mode === "light" ? {
                    width: 30, height: 30,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 32% 28%, #5090d0 0%, #2060a0 40%, #0a2040 100%)",
                    border: "1.5px solid rgba(100,180,255,0.35)",
                    boxShadow:
                      "0 3px 10px rgba(0,20,60,0.7), " +
                      "0 1px 0 rgba(120,180,255,0.25), " +
                      "inset 0 1px 3px rgba(120,200,255,0.3), " +
                      "inset 0 -2px 4px rgba(0,20,60,0.5)",
                  } : {
                    width: 30, height: 30,
                    borderRadius: "50%",
                    background: "radial-gradient(circle at 32% 28%, #72727e 0%, #38383f 40%, #1a1a20 100%)",
                    border: "1.5px solid rgba(255,255,255,0.18)",
                    boxShadow:
                      "0 3px 10px rgba(0,0,0,0.8), " +
                      "0 1px 0 rgba(255,255,255,0.12), " +
                      "inset 0 1px 3px rgba(255,255,255,0.15), " +
                      "inset 0 -2px 4px rgba(0,0,0,0.6)",
                  }}
                >
                  <div
                    style={mode === "light" ? {
                      width: 12, height: 12,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 40% 35%, #3070b0, #0a2040)",
                      border: "1px solid rgba(0,20,60,0.8)",
                      boxShadow: "inset 0 1px 5px rgba(0,20,60,1), 0 0 0 1px rgba(100,180,255,0.1)",
                    } : {
                      width: 12, height: 12,
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 40% 35%, #444, #111)",
                      border: "1px solid rgba(0,0,0,0.7)",
                      boxShadow: "inset 0 1px 5px rgba(0,0,0,1), 0 0 0 1px rgba(255,255,255,0.04)",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* RIGHT AREA — z-2 at rest, raised to z-100 during animation.
                The flipper lives here so it can pass over the spine rings. */}
            <div
              ref={rightAreaRef}
              className="flex-1 min-w-0 relative"
              style={{ zIndex: 2 }}
            >
              {/* UNDERLAY — absolute, z-0, always beneath the flipper.
                  Pre-loaded with next-right content so the area shows something as the flipper
                  begins to rotate away (instead of showing empty page background). */}
              <div className="absolute inset-0 z-[0]">
                <BinderPage
                  nfts={pages[underlayIdx] ?? []}
                  collectionName={collection.name}
                  onOpen={setOpenLauncherId}
                  totalSupply={collection.totalSupply}
                  rarityTiers={collection.rarityTiers}
                  side="right"
                />
              </div>

              {/* FLIPPER — preserve-3d; transform-origin: left center (rotates around the spine).
                  Front face (backfaceVisibility: hidden) shows the current right page.
                  Back face (rotateY(180deg) + backfaceVisibility: hidden) shows the pre-loaded
                  next-left page — it becomes visible after the flipper passes 90°. */}
              <div
                ref={flipperRef}
                className="absolute inset-0 z-[1]"
                style={{ transformStyle: "preserve-3d", transformOrigin: "left center" }}
              >
                {/* FRONT FACE: current right page */}
                <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
                  <BinderPage
                    nfts={pages[frontIdx] ?? []}
                    collectionName={collection.name}
                    onOpen={setOpenLauncherId}
                    totalSupply={collection.totalSupply}
                    rarityTiers={collection.rarityTiers}
                    side="right"
                  />
                </div>

                {/* BACK FACE: pre-loaded next-left page.
                    rotateY(180deg) so it faces left when the flipper is past 90°.
                    side="left" so its corner radii match a left-side page. */}
                <div
                  className="absolute inset-0"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <BinderPage
                    nfts={pages[backIdx] ?? []}
                    collectionName={collection.name}
                    onOpen={setOpenLauncherId}
                    totalSupply={collection.totalSupply}
                    rarityTiers={collection.rarityTiers}
                    side="left"
                  />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* MOBILE — one page at a time, starts at page 1, swipe or use controls to advance */}
        {/* Phones + tablets: a readable, aspect-locked grid. Cards keep a 5:7 shape at any width;
            the 3-D flip spread is reserved for large desktops (lg+) where it renders cleanly. */}
        <div
          className="tcg-binder-page tcg-binder-grid grid items-start grid-cols-2 gap-2 rounded-xl p-2 sm:grid-cols-3 lg:grid-cols-4 xl:hidden"
          onTouchStart={handleMobileTouchStart}
          onTouchEnd={handleMobileTouchEnd}
        >
          {gridSlice.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center gap-3 py-16">
              <span className="h-8 w-8 animate-spin rounded-full" style={{ border: "3px solid var(--card-border)", borderTopColor: "transparent" }} />
              <span className="text-subtle text-sm">Loading cards…</span>
            </div>
          ) : gridSlice.map((n) => (
            <div key={n.launcherId} className="tcg-sleeve">
              <NftRarityCard
                nft={n}
                collectionName={collection.name}
                onOpen={setOpenLauncherId}
                totalSupply={collection.totalSupply}
                rarityTiers={collection.rarityTiers}
              />
            </div>
          ))}
        </div>

      </div>

      {openNft && (
        <NftDetailModal
          nft={openNft}
          collectionName={collection.name}
          totalSupply={collection.totalSupply}
          rarityTiers={collection.rarityTiers}
          onClose={() => setOpenLauncherId(null)}
          fullPageHref={hideFullPageLink ? null : undefined}
          fromPortfolio={fromPortfolio}
        />
      )}
    </div>

    {/* Controls float freely below the binder shell — spread paging on desktop, single-page on mobile */}
    <div className="hidden xl:block">
      <BinderPageControls
        pageIndex={displaySpread}
        pageCount={spreadCount}
        onPrev={() => flipSpread(-1)}
        onNext={() => flipSpread(1)}
        disabled={animating}
      />
    </div>
    {/* Grid controls — phones + tablets page through the readable grid (12 per page). */}
    <div className="xl:hidden">
      {(gridTotal > 1 || hasMore) && (
        <BinderPageControls
          pageIndex={gp}
          pageCount={hasMore ? gridTotal + 1 : gridTotal}
          onPrev={() => setGridPage(Math.max(0, gp - 1))}
          onNext={() => gridFlip(1)}
          disabled={false}
        />
      )}
    </div>
    </div>
  );
}
