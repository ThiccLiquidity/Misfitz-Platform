// Pure, dependency-free market constants. Kept OUT of dexie.ts so client-reachable code (e.g. the deal
// score helper in enrich.ts, imported by the collection binder) can use them WITHOUT dragging the
// server-only data layer (which imports node:fs / node:sqlite) into the browser bundle.
export const XCH_USD_FALLBACK = 1.58; // ~current XCH/USD (Jul 2026). Update periodically; only used when the live rate + shared cache are both unavailable.
