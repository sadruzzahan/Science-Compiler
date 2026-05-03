import { db, metricsBucketsTable } from "@workspace/db";
import { logger } from "./logger";

interface RouteBucket {
  route: string;
  method: string;
  bucketStart: number;
  requests: number;
  errors: number;
  durations: number[];
}

const BUCKET_MS = 60_000;
const RING_SIZE = 120;

const ringByKey = new Map<string, RouteBucket[]>();

const sseConnections = new Set<string>();

export function recordRequest(route: string, method: string, statusCode: number, durationMs: number): void {
  const bucketStart = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const key = `${method} ${route}`;
  let ring = ringByKey.get(key);
  if (!ring) {
    ring = [];
    ringByKey.set(key, ring);
  }
  let bucket = ring[ring.length - 1];
  if (!bucket || bucket.bucketStart !== bucketStart) {
    bucket = { route, method, bucketStart, requests: 0, errors: 0, durations: [] };
    ring.push(bucket);
    if (ring.length > RING_SIZE) ring.shift();
  }
  bucket.requests++;
  if (statusCode >= 500) bucket.errors++;
  if (bucket.durations.length < 1000) bucket.durations.push(durationMs);
}

export function trackSseOpen(id: string): void { sseConnections.add(id); }
export function trackSseClose(id: string): void { sseConnections.delete(id); }
export function activeSseCount(): number { return sseConnections.size; }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface BucketSummary {
  route: string;
  method: string;
  bucketStart: number;
  requests: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
}

function summarize(b: RouteBucket): BucketSummary {
  const sorted = [...b.durations].sort((a, c) => a - c);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    route: b.route,
    method: b.method,
    bucketStart: b.bucketStart,
    requests: b.requests,
    errors: b.errors,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
    avgMs: sorted.length ? sum / sorted.length : 0,
    maxMs: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

export function getInMemoryBuckets(): BucketSummary[] {
  const out: BucketSummary[] = [];
  for (const ring of ringByKey.values()) {
    for (const b of ring) out.push(summarize(b));
  }
  return out;
}

export function getRecentErrorRate(windowMs = 5 * 60_000): { requests: number; errors: number; rate: number } {
  const cutoff = Date.now() - windowMs;
  let requests = 0;
  let errors = 0;
  for (const ring of ringByKey.values()) {
    for (const b of ring) {
      if (b.bucketStart < cutoff) continue;
      requests += b.requests;
      errors += b.errors;
    }
  }
  return { requests, errors, rate: requests > 0 ? errors / requests : 0 };
}

let lastFlushedBucket = 0;

export async function flushBucketsToDb(): Promise<number> {
  const now = Date.now();
  const currentBucket = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const toFlush: BucketSummary[] = [];
  for (const ring of ringByKey.values()) {
    for (const b of ring) {
      if (b.bucketStart < currentBucket && b.bucketStart > lastFlushedBucket) {
        toFlush.push(summarize(b));
      }
    }
  }
  if (toFlush.length === 0) return 0;
  try {
    await db.insert(metricsBucketsTable).values(
      toFlush.map((b) => ({
        bucketStart: new Date(b.bucketStart),
        route: b.route,
        method: b.method,
        requests: b.requests,
        errors: b.errors,
        p50Ms: b.p50Ms,
        p95Ms: b.p95Ms,
        p99Ms: b.p99Ms,
        avgMs: b.avgMs,
        maxMs: b.maxMs,
      })),
    );
    lastFlushedBucket = currentBucket - BUCKET_MS;
    return toFlush.length;
  } catch (err) {
    logger.warn({ err }, "metrics flush failed");
    return 0;
  }
}

let flushTimer: NodeJS.Timeout | null = null;
export function startMetricsFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushBucketsToDb();
  }, BUCKET_MS);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

export function stopMetricsFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

export function _resetMetricsForTests(): void {
  ringByKey.clear();
  sseConnections.clear();
  lastFlushedBucket = 0;
}
