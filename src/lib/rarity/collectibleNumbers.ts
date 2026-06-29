// Special / collectible mint numbers (VALUATION.md Part 2). A desirability layer, NOT rarity — it
// never touches the OpenRarity rank. Produces a badge (always) + a tiered value weight (grails
// move price, the rest are mostly just fun). Highest tier wins; one badge, one bump, no stacking.

export type CollectibleTier = 1 | 2 | 3 | 4;

export interface CollectibleNumber {
  number: number;
  tier: CollectibleTier; // 1 = grail … 4 = fun
  label: string;
  weight: number; // value-bump factor applied to floor (desirability premium), capped per tier
}

// Value weight per tier — generous badges, disciplined value (only grails meaningfully move price).
export const TIER_WEIGHTS: Record<CollectibleTier, number> = { 1: 0.4, 2: 0.1, 3: 0.03, 4: 0 };

interface Match {
  tier: CollectibleTier;
  label: string;
}

const digitsOf = (n: number) => String(n);
const allSame = (s: string) => s.length >= 2 && [...s].every((c) => c === s[0]);
const isPalindrome = (s: string) => s.length >= 3 && s === [...s].reverse().join("");

function isAscRun(s: string): boolean {
  if (s.length < 3) return false;
  for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) !== s.charCodeAt(i - 1) + 1) return false;
  return true;
}
function isDescRun(s: string): boolean {
  if (s.length < 3) return false;
  for (let i = 1; i < s.length; i++) if (s.charCodeAt(i) !== s.charCodeAt(i - 1) - 1) return false;
  return true;
}
function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

const MEMES: Record<number, Match> = {
  69: { tier: 1, label: "Nice" },
  420: { tier: 1, label: "Blaze" },
  1337: { tier: 1, label: "Leet" },
  42: { tier: 2, label: "The Answer" },
  666: { tier: 2, label: "Beast" },
  404: { tier: 3, label: "Not Found" },
  13: { tier: 3, label: "Baker's Dozen" },
  7: { tier: 2, label: "Lucky 7" },
};
const ANGELS = new Set([1010, 1212, 1234]);
const JERSEYS = new Set([21, 23, 24]);

// Returns every category an n matches (in priority order); caller picks the best tier.
function candidates(n: number, size: number, custom?: number | null): Match[] {
  const s = digitsOf(n);
  const len = s.length;
  const out: Match[] = [];

  if (custom && n === custom) out.push({ tier: 1, label: "Collector's Number" });
  if (n === 1) out.push({ tier: 1, label: "Genesis" });
  if (size > 0 && n === size) out.push({ tier: 1, label: "Finale" });
  if (MEMES[n]) out.push(MEMES[n]);

  if (allSame(s)) {
    const d = s[0];
    if (len >= 4) out.push({ tier: 1, label: n === 7777 ? "Jackpot" : n === 8888 ? "Lucky 8s" : `Quad ${d}s` });
    else if (len === 3) out.push({ tier: 2, label: d === "7" ? "Lucky 7s" : d === "8" ? "Triple 8s" : `Triple ${d}s` });
    else out.push({ tier: 3, label: d === "7" || d === "8" ? `Lucky ${d}s` : `Double ${d}s` });
  }

  if (n >= 2 && n <= 9) out.push({ tier: 2, label: `Single Digit #${n}` });

  if (n === 1000 || n === 10000) out.push({ tier: 2, label: "Milestone" });
  else if (n === 100) out.push({ tier: 3, label: "Century" });
  else if (n % 1000 === 0) out.push({ tier: 3, label: "Round Thousand" });
  else if (n % 100 === 0) out.push({ tier: 4, label: "Round Hundred" });

  if (ANGELS.has(n)) out.push({ tier: 3, label: "Angel Number" });
  if (isPalindrome(s)) out.push(len >= 4 ? { tier: 2, label: "Mirror" } : { tier: 3, label: "Palindrome" });
  if (isAscRun(s) || isDescRun(s)) out.push(len >= 4 ? { tier: 2, label: "Straight" } : { tier: 3, label: "Run" });

  if (isPowerOfTwo(n) && n >= 16) out.push(n >= 256 ? { tier: 3, label: "Power of Two" } : { tier: 4, label: "Power of Two" });

  if (JERSEYS.has(n)) out.push({ tier: 4, label: "Jersey" });
  if (n >= 10 && n <= 99) out.push({ tier: 4, label: "Early Mint" });

  return out;
}

// The collectible classification for a mint number, or null if it isn't special.
export function collectibleNumber(
  n: number | null | undefined,
  collectionSize = 0,
  customNumber?: number | null,
): CollectibleNumber | null {
  if (!n || !Number.isInteger(n) || n < 1) return null;
  const matches = candidates(n, collectionSize, customNumber);
  if (matches.length === 0) return null;
  // Lowest tier wins; among equal tiers the earliest (higher-priority) match.
  let best = matches[0];
  for (const m of matches) if (m.tier < best.tier) best = m;
  return { number: n, tier: best.tier, label: best.label, weight: TIER_WEIGHTS[best.tier] };
}
