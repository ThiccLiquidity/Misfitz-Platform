// Per-collection "busyness", derived ONLY from data we already fetch (completed sales) — so detecting a
// hot collection costs ZERO extra API calls. A busy collection's floor / listings / cards refresh faster;
// a quiet one keeps the long TTL. Because every fetch is demand-driven (we only pull when someone is
// actually viewing a collection), this just tunes HOW FRESH a viewed collection is — we never poll a
// collection nobody is looking at.

type Level = 0 | 1 | 2; // 0 = quiet, 1 = warm, 2 = hot

interface Entry { level: Level; at: number }
const _activity = new Map<string, Entry>();

// A burst of sales in this trailing window reads as busy; as sales age out of the window the level falls
// back on its own, so a collection that cools down stops fast-polling automatically.
const WINDOW_MS = 6 * 60 * 60_000; // 6 hours
const WARM_MIN = 3;                // >= this many recent sales -> warm
const HOT_MIN = 8;                 // >= this many recent sales -> hot

// Activity is only trusted while fresh. If we haven't re-measured a collection in this long, treat it as
// quiet again (so a once-hot collection can't keep fast-polling forever off a stale reading).
const STALE_MS = 45 * 60_000;

// Hard floor on any adaptive TTL — even a red-hot collection never polls faster than this, which protects
// the free public MintGarden/Dexie APIs from a launch spike (a rate-limit would show EVERYONE stale data).
const MIN_TTL_MS = 45_000;

/** Record activity from a completed-sales list we just fetched (or read from cache). No network. */
export function recordSalesActivity(colId: string, sales: { date?: string }[]): void {
  const now = Date.now();
  let recent = 0;
  for (const s of sales) {
    const t = s.date ? new Date(s.date).getTime() : 0;
    if (t && now - t <= WINDOW_MS) recent++;
  }
  const level: Level = recent >= HOT_MIN ? 2 : recent >= WARM_MIN ? 1 : 0;
  _activity.set(colId, { level, at: now });
}

/** Current busyness level for a collection (0 quiet / 1 warm / 2 hot). Decays to quiet when stale. */
export function activityLevel(colId: string): Level {
  const e = _activity.get(colId);
  if (!e || Date.now() - e.at > STALE_MS) return 0;
  return e.level;
}

/**
 * Scale a base cache TTL by how busy the collection is: hot ≈ 1/5th, warm ≈ 1/2, quiet = base — clamped
 * to MIN_TTL_MS so we never hammer the APIs. Quiet collections behave exactly as before.
 */
export function adaptiveTtl(colId: string, baseMs: number): number {
  const lvl = activityLevel(colId);
  const scaled = lvl === 2 ? baseMs / 5 : lvl === 1 ? baseMs / 2 : baseMs;
  return Math.max(MIN_TTL_MS, Math.round(scaled));
}
