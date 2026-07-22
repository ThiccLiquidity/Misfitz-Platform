"use client";

import { useState, type ReactNode } from "react";
import type { NftData } from "@/types";
import { NftRarityCard } from "@/components/nft/NftRarityCard";
import { colorForLabel, funLabel } from "@/components/nft/DealScoreGauge";
import { TIER_ORDER, type TierId } from "@/lib/rarity/tiers";

const SUPPLY = 1000;
const TIER_RANKS: Record<TierId, number> = { mythic: 1, legendary: 4, epic: 20, rare: 80, uncommon: 250, common: 800 };
const TIER_DEALS: Record<TierId, { label: string; score: number } | "unscored" | null> = {
  mythic: { label: "GREAT DEAL", score: 92 },
  legendary: { label: "GOOD DEAL", score: 74 },
  epic: { label: "FAIR DEAL", score: 52 },
  rare: { label: "OVERPRICED", score: 18 },
  uncommon: "unscored",
  common: null,
};

function mockNft(tier: TierId): NftData {
  const rank = TIER_RANKS[tier];
  const deal = TIER_DEALS[tier];
  const listed = deal !== null;
  return {
    id: `lab-${tier}`,
    launcherId: `lab-${tier}`,
    collectionSlug: "theme-lab",
    name: `Specimen #${rank}`,
    imageUrl: "/brand/logo-mark.png",
    traits: [
      { trait_type: "Background", value: "Gold Foil", rarityPercent: 0.4 },
      { trait_type: "Eyes", value: "Laser", rarityPercent: 2.1 },
      { trait_type: "Hat", value: "Propeller Cap", rarityPercent: 7.8 },
      { trait_type: "Mood", value: "Smug", rarityPercent: 24.5 },
      { trait_type: "Base", value: "Classic", rarityPercent: 61.0 },
    ],
    rarityRank: rank,
    rankEstimated: tier === "epic",
    currentOwnerAddress: "xch1qxyzlabspecimenaddr000000000000000000000000000000000000",
    fairValue: { totalEstimate: 4.9, totalEstimateUsd: 132.3, floorValue: 3.2, rarityPremium: 1.4, traitPremium: 0.3, desirabilityPremium: 0 },
    rarityScore: 87.3,
    listing: listed ? { priceXch: 4.2, priceUsd: 113.4 } : null,
    dealScore: deal && deal !== "unscored" ? deal : null,
  } as unknown as NftData;
}

const DEAL_LABELS = ["GREAT DEAL", "GOOD DEAL", "FAIR DEAL", "OVERPRICED"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2 className="text-sm font-black uppercase tracking-widest" style={{ color: "var(--subtle)" }}>{title}</h2>
      <div className="tf-hairline" style={{ height: 1, margin: "6px 0 16px" }} />
      {children}
    </section>
  );
}

export function ThemeLab() {
  const [freeze, setFreeze] = useState(false);
  const setTheme = (mode: "dark" | "light" | "nostalgia") => {
    window.localStorage.setItem("chia-collector-theme-mode", mode);
    window.location.href = "/theme-lab";
  };
  return (
    <div className={freeze ? "lab-freeze" : undefined} style={{ padding: "24px 20px 80px", maxWidth: 1400, margin: "0 auto" }}>
      <style>{`.lab-freeze *, .lab-freeze *::before, .lab-freeze *::after { animation-play-state: paused !important; transition: none !important; }`}</style>

      <div className="tf-panel" style={{ borderRadius: 12, padding: "10px 14px", marginBottom: 28, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="text-xs font-black" style={{ color: "var(--title)" }}>THEME LAB</span>
        <button className="tf-pill" onClick={() => setTheme("dark")}>Dark</button>
        <button className="tf-pill" onClick={() => setTheme("light")}>Light</button>
        <button className="tf-pill" onClick={() => setTheme("nostalgia")}>Nostalgia</button>
        <label className="text-xs" style={{ color: "var(--subtle)", marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} /> Freeze animations
        </label>
      </div>

      <Section title="Collection header (.ch-*) + foil headline">
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div className="ch-stripe" style={{ width: 6, height: 64, borderRadius: 3 }} />
          <div>
            <h1 className="ch-title" style={{ fontSize: 44, fontWeight: 900, lineHeight: 1.05 }}>Misfitz</h1>
            <p className="ch-desc text-sm" style={{ maxWidth: 520 }}>A specimen description line — body copy sitting on the page surface.</p>
          </div>
          <span className="ch-badge text-xs font-black" style={{ color: "#fff", padding: "4px 12px", borderRadius: 999 }}>BINDER</span>
        </div>
        <p className="tf-foil" style={{ fontSize: 28, fontWeight: 900, marginTop: 12 }}>Foil headline sample</p>
      </Section>

      <Section title="Rarity cards — mythic → common (every deal-pill state)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, 252px)", gap: 18 }}>
          {TIER_ORDER.map((tier) => (
            <div key={tier} style={{ width: 252 }}>
              <NftRarityCard nft={mockNft(tier)} collectionName="Theme Lab" totalSupply={SUPPLY} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Deal pills + chips">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {DEAL_LABELS.map((l) => (
            <span key={l} style={{ background: colorForLabel(l), color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.35)" }}>{funLabel(l)}</span>
          ))}
        </div>
      </Section>

      <Section title="Panel chrome (.tf-panel) — controls + stat row">
        <div className="tf-panel" style={{ borderRadius: 14, padding: 18, maxWidth: 720 }}>
          <div className="text-base font-black" style={{ color: "var(--title)" }}>Your Binder</div>
          <div className="text-xs" style={{ color: "var(--subtle)", marginBottom: 12 }}>Subtle helper text on panel leather</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input className="tf-search text-sm" style={{ borderRadius: 8, border: "1px solid", padding: "6px 10px" }} placeholder="Search traits…" />
            <select className="tf-select text-sm" style={{ borderRadius: 8, border: "1px solid", padding: "6px 10px" }}><option>Sort: Rarity</option></select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button className="tf-pill">All</button>
            <button className="tf-pill">For sale</button>
            <button className="tf-pill">🔥 Gold Background</button>
          </div>
          <div className="tf-tabbar" style={{ display: "flex", gap: 4, borderBottom: "1px solid" }}>
            <button className="tf-tab tf-tab--active" style={{ border: "1px solid" }}>Binder</button>
            <button className="tf-tab">Stats</button>
            <button className="tf-tab">Info</button>
          </div>
          <div style={{ display: "flex", gap: 28, paddingTop: 14, flexWrap: "wrap" }}>
            {[["Floor value", "12.40 XCH", "$334.80"], ["Traitfolio value", "18.92 XCH", "$510.84"], ["NFTs", "47", "3 collections"]].map(([l, v, s]) => (
              <div key={l}>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--subtle)" }}>{l}</div>
                <div className="text-lg font-black" style={{ color: "var(--title)" }}>{v}</div>
                <div className="text-[11px]" style={{ color: "var(--subtle)" }}>{s}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Binder shell + page + sleeves (.tcg-binder-*)">
        <div className="tcg-binder-shell" style={{ borderRadius: 16, padding: 22, maxWidth: 720 }}>
          <div className="tcg-binder-page" style={{ borderRadius: 10, padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="tcg-sleeve" style={{ borderRadius: 8, height: 120, display: "grid", placeItems: "center" }}>
                  <span className="text-xs" style={{ color: "var(--subtle)" }}>sleeve</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Type specimen — page surface (left) vs panel leather (right)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 900 }}>
          {[false, true].map((onPanel) => (
            <div key={String(onPanel)} className={onPanel ? "tf-panel" : undefined}
              style={{ borderRadius: 12, padding: 16, ...(onPanel ? {} : { background: "var(--page-bg)", border: "1px solid var(--card-border)" }) }}>
              <div className="text-xl font-black" style={{ color: "var(--title)" }}>Heading 20px — 4.20 XCH</div>
              <div className="text-sm font-bold" style={{ color: "var(--title)" }}>Value 14px — 18.92 XCH ($510.84)</div>
              <div className="text-xs" style={{ color: "var(--subtle)" }}>Sub 12px — Rank #47 · Top 2.5% · 87.3 score</div>
              <div className="text-[11px]" style={{ color: "var(--subtle)" }}>Tiny 11px — est. $132.30 · 6 traits · ≈#20</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
