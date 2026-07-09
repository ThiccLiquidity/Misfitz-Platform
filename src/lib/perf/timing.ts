// Ultra-light in-process request timing so /api/status can show p50/p95/p99 per endpoint WITHOUT costing a
// single Redis command or writing anything to storage. A serverless instance handles many requests while
// warm, so its own ring buffer is a representative sample of real latency — and p95 is where cold starts,
// cache misses, and the one giant collection surface first (they hide in the average). Per-instance, not
// globally aggregated; resets when the instance recycles. Zero deps, O(1) record, sort only on read.

const MAX_SAMPLES = 500; // per endpoint ring buffer — bounds memory, keeps p95 recent

interface Bucket { samples: number[]; total: number; count: number }
const buckets = new Map<string, Bucket>();

// Record one observed duration (ms) under a stable endpoint label.
export function recordTiming(endpoint: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  let b = buckets.get(endpoint);
  if (!b) { b = { samples: [], total: 0, count: 0 }; buckets.set(endpoint, b); }
  b.count += 1;
  b.total += ms;
  b.samples.push(ms);
  if (b.samples.length > MAX_SAMPLES) b.samples.shift();
}

// Time an async fn and record it under `endpoint` — always records, even if the fn throws.
export async function timed<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try { return await fn(); }
  finally { recordTiming(endpoint, Date.now() - t0); }
}

// Nearest-rank percentile from a sorted ascending array.
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export interface EndpointStat {
  count: number;   // lifetime requests this instance has served for this endpoint
  sampled: number; // how many are in the p-stat window (<= MAX_SAMPLES)
  avg: number;     // lifetime mean (ms)
  p50: number;     // median of the window (ms)
  p95: number;     // the number that matters (ms)
  p99: number;     // ms
  max: number;     // slowest in the window (ms)
}

// Snapshot for /api/status. Cheap: sorts a copy of each (<=500-item) window on demand.
export function perfSnapshot(): Record<string, EndpointStat> {
  const out: Record<string, EndpointStat> = {};
  for (const [ep, b] of buckets) {
    const s = [...b.samples].sort((a, c) => a - c);
    out[ep] = {
      count: b.count,
      sampled: s.length,
      avg: b.count ? Math.round(b.total / b.count) : 0,
      p50: Math.round(pct(s, 50)),
      p95: Math.round(pct(s, 95)),
      p99: Math.round(pct(s, 99)),
      max: s.length ? s[s.length - 1] : 0,
    };
  }
  return out;
}
