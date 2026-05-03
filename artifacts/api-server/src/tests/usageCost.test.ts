import { describe, it, expect } from "vitest";
import { computeCostUsd, getQuotaForPlan, planForUser, utcDayStart, nextUtcDayStart } from "../lib/usage";

describe("computeCostUsd", () => {
  it("computes gpt-4o-mini cost from per-million pricing", () => {
    // 1M input @ $0.15, 1M output @ $0.60 => 0.15 + 0.60 = 0.75
    expect(computeCostUsd("gpt-4o-mini", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });

  it("computes embedding cost (output zero)", () => {
    // 1M input @ $0.02
    expect(computeCostUsd("text-embedding-3-small", 1_000_000, 0)).toBeCloseTo(0.02, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCostUsd("gpt-4o", 0, 0)).toBe(0);
  });

  it("falls back to a non-zero rate for unknown models", () => {
    const cost = computeCostUsd("gpt-9999-vapor", 1_000_000, 0);
    expect(cost).toBeGreaterThan(0);
  });

  it("rounds to 6 decimal places (numeric column friendly)", () => {
    const cost = computeCostUsd("gpt-4o-mini", 7, 3);
    // Result should never have more than 6dp
    expect(cost.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});

describe("plan helpers", () => {
  it("admins are unlimited", () => {
    expect(getQuotaForPlan("admin")).toBe(Number.POSITIVE_INFINITY);
    expect(planForUser({ role: "admin" })).toBe("admin");
  });

  it("regular users default to the user plan", () => {
    expect(planForUser({ role: "user" })).toBe("user");
    expect(getQuotaForPlan("user")).toBeGreaterThan(0);
    expect(Number.isFinite(getQuotaForPlan("user"))).toBe(true);
  });

  it("pro plan gets a higher quota than user plan", () => {
    expect(getQuotaForPlan("pro")).toBeGreaterThan(getQuotaForPlan("user"));
  });
});

describe("UTC day boundaries", () => {
  it("utcDayStart zeroes the time portion", () => {
    const d = utcDayStart(new Date(Date.UTC(2026, 4, 3, 14, 30, 5)));
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCDate()).toBe(3);
  });

  it("nextUtcDayStart is 24h after the previous day's start", () => {
    const now = new Date(Date.UTC(2026, 4, 3, 14, 30, 5));
    const next = nextUtcDayStart(now);
    expect(next.getTime() - utcDayStart(now).getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
