import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stubbed select(...).from(...).where(...) chain. Tests set COUNT_RESULT
// before each call to control what `getDailyUsageCountForUser` returns.
const COUNT_RESULT: { value: number } = { value: 0 };

vi.mock("@workspace/db", () => {
  const where = vi.fn(async () => [{ count: COUNT_RESULT.value }]);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select, insert: vi.fn() },
    usageEventsTable: { userId: {}, createdAt: {}, costUsd: {}, route: {} },
  };
});

import express from "express";
import request from "supertest";
import { enforceSynthesisQuota, _resetUsageStateForTests } from "../lib/usage";

let MOCK_USER: { id: string; role: "user" | "admin"; email: string } | null = null;

function makeApp() {
  const app = express();
  app.get(
    "/protected",
    (req, _res, next) => {
      (req as any).currentUser = MOCK_USER;
      next();
    },
    enforceSynthesisQuota,
    (_req, res) => res.json({ ok: true }),
  );
  return app;
}

describe("enforceSynthesisQuota middleware", () => {
  beforeEach(() => {
    MOCK_USER = { id: "u-test", role: "user", email: "t@example.com" };
    COUNT_RESULT.value = 0;
    _resetUsageStateForTests();
  });
  afterEach(() => {
    MOCK_USER = null;
  });

  it("allows the request when the user is below their daily quota", async () => {
    COUNT_RESULT.value = 1;
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 429 with QUOTA_EXCEEDED + Retry-After when at the daily limit", async () => {
    COUNT_RESULT.value = 9999; // way above default user quota of 5
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("QUOTA_EXCEEDED");
    expect(res.body.retryAfter).toBeGreaterThan(0);
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("admins bypass the quota check (unlimited plan)", async () => {
    MOCK_USER = { id: "admin-1", role: "admin", email: "a@example.com" };
    COUNT_RESULT.value = 9999;
    const res = await request(makeApp()).get("/protected");
    expect(res.status).toBe(200);
  });
});
