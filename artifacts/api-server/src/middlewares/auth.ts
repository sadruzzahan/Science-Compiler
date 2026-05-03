import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendUnauthenticated, sendForbidden } from "../lib/authErrors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: User;
    }
  }
}

const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isPublicReadEnabled(): boolean {
  return (process.env.PUBLIC_READ_ENABLED ?? "true").toLowerCase() !== "false";
}

async function loadUser(req: Request): Promise<User | null> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkUserId)).limit(1);
  if (user) return user;

  // First-time user just signed in but webhook hasn't fired yet — JIT provision.
  try {
    const sessionClaims = (auth.sessionClaims ?? {}) as Record<string, unknown>;
    const email =
      (typeof sessionClaims.email === "string" && sessionClaims.email) ||
      (typeof sessionClaims.primary_email === "string" && sessionClaims.primary_email) ||
      `${clerkUserId}@unknown.local`;
    const role: "user" | "admin" = ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "user";

    // Race-safe: ON CONFLICT lets concurrent first-requests both succeed.
    const [created] = await db
      .insert(usersTable)
      .values({ clerkId: clerkUserId, email, role, status: "active" })
      .onConflictDoUpdate({
        target: usersTable.clerkId,
        set: { updatedAt: sql`now()` },
      })
      .returning();
    return created ?? null;
  } catch (err) {
    logger.error({ err, clerkUserId }, "Failed to JIT-provision user");
    return null;
  }
}

export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const user = await loadUser(req);
    if (user) req.currentUser = user;
  } catch (err) {
    logger.error({ err }, "attachUser middleware failed");
  }
  next();
};

export const requireUser: RequestHandler = async (req, res, next) => {
  if (!req.currentUser) {
    const user = await loadUser(req);
    if (user) req.currentUser = user;
  }
  if (!req.currentUser) {
    sendUnauthenticated(res);
    return;
  }
  if (req.currentUser.status === "suspended") {
    sendForbidden(res, "Account suspended");
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  if (!req.currentUser) {
    const user = await loadUser(req);
    if (user) req.currentUser = user;
  }
  if (!req.currentUser) {
    sendUnauthenticated(res);
    return;
  }
  if (req.currentUser.status === "suspended") {
    sendForbidden(res, "Account suspended");
    return;
  }
  if (req.currentUser.role !== "admin") {
    sendForbidden(res, "Admin access required");
    return;
  }
  next();
};

export const requirePublicReadOrUser: RequestHandler = async (req, res, next) => {
  if (isPublicReadEnabled()) {
    next();
    return;
  }
  return requireUser(req, res, next);
};

export function adminEmails(): string[] {
  return ADMIN_EMAILS;
}
