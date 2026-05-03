import { describe, it, expect, beforeEach } from "vitest";
import {
  recordRequest,
  trackSseOpen,
  trackSseClose,
  activeSseCount,
  getInMemoryBuckets,
  getRecentErrorRate,
  _resetMetricsForTests,
} from "../lib/metrics";
import { withSpan } from "../lib/spans";

describe("metrics ring buffer", () => {
  beforeEach(() => _resetMetricsForTests());

  it("records and aggregates requests + errors per route", () => {
    for (let i = 0; i < 5; i++) recordRequest("/api/test", "GET", 200, 10 + i);
    recordRequest("/api/test", "GET", 500, 50);
    const buckets = getInMemoryBuckets().filter((b) => b.route === "/api/test");
    const sumReq = buckets.reduce((s, b) => s + b.requests, 0);
    const sumErr = buckets.reduce((s, b) => s + b.errors, 0);
    expect(sumReq).toBe(6);
    expect(sumErr).toBe(1);
    const last = buckets[buckets.length - 1];
    expect(last.p95Ms).toBeGreaterThan(0);
  });

  it("computes recent error rate", () => {
    recordRequest("/api/x", "GET", 200, 1);
    recordRequest("/api/x", "GET", 500, 1);
    const r = getRecentErrorRate();
    expect(r.requests).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.rate).toBeCloseTo(0.5);
  });

  it("tracks SSE counters", () => {
    expect(activeSseCount()).toBe(0);
    trackSseOpen("a");
    trackSseOpen("b");
    expect(activeSseCount()).toBe(2);
    trackSseClose("a");
    expect(activeSseCount()).toBe(1);
    trackSseClose("b");
  });
});

describe("withSpan", () => {
  it("returns the inner result on success", async () => {
    const result = await withSpan(
      { pipeline: "query", requestId: "req1" },
      "test_op",
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return 42;
      },
    );
    expect(result).toBe(42);
  });

  it("rethrows errors from the inner function", async () => {
    await expect(
      withSpan({ pipeline: "query", requestId: "req2" }, "fail_op", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
