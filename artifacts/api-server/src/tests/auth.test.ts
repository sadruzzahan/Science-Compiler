import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const where = vi.fn();
  const limit = vi.fn();
  const from = vi.fn(() => ({ where: (...args: unknown[]) => where(...args) }));
  const select = vi.fn(() => ({ from }));
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return {
    db: { select, insert },
    usersTable: {},
    __mocks: { select, from, where, limit, insert, values, returning },
  };
});

import { getAuth } from "@clerk/express";
import * as dbModule from "@workspace/db";
import { requireUser, requireAdmin } from "../middlewares/auth";
import type { User } from "@workspace/db";

function makeUser(over: Partial<User>): User {
  return {
    id: "u1",
    clerkId: "ck_1",
    email: "u@example.com",
    firstName: null,
    lastName: null,
    imageUrl: null,
    role: "user",
    status: "active",
    lastSignInAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as User;
}

const mocks = (dbModule as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks;

function makeReqRes() {
  const req = {} as Request & { currentUser?: unknown };
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  const res = { status, json, setHeader } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next, json, status, setHeader };
}

describe("auth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make select(...).from(...).where(...).limit(...) return [] by default
    mocks.where.mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
  });

  it("requireUser returns 401 when no Clerk session", async () => {
    (getAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const { req, res, next, status, json } = makeReqRes();
    await requireUser(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ code: "UNAUTHENTICATED", error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAdmin returns 403 when user is not admin", async () => {
    const { req, res, next, status, json } = makeReqRes();
    req.currentUser = makeUser({ role: "user" });
    await requireAdmin(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: "FORBIDDEN", error: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAdmin returns 403 (not 401) when caller is anonymous", async () => {
    (getAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ userId: null });
    const { req, res, next, status, json } = makeReqRes();
    await requireAdmin(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: "FORBIDDEN", error: "Admin access required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAdmin calls next when user is admin", async () => {
    const { req, res, next } = makeReqRes();
    req.currentUser = makeUser({ role: "admin" });
    await requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("requireUser returns 403 for suspended account", async () => {
    const { req, res, next, status, json } = makeReqRes();
    req.currentUser = makeUser({ status: "suspended" });
    await requireUser(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: "FORBIDDEN", error: "Account suspended" });
    expect(next).not.toHaveBeenCalled();
  });
});
