import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db, usageEventsTable } from "@workspace/db";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Pricing & cost calculator
// ---------------------------------------------------------------------------

// USD per 1M tokens. Conservative public list-price snapshot — update as
// OpenAI prices change. Unknown models fall back to the gpt-4o-mini bracket
// so we don't silently undercount spend.
const PRICE_TABLE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5": { input: 2.5, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

const UNKNOWN_MODEL_FALLBACK = { input: 0.5, output: 2.0 };

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price =
    PRICE_TABLE_PER_MILLION[model] ??
    PRICE_TABLE_PER_MILLION[model.toLowerCase()] ??
    UNKNOWN_MODEL_FALLBACK;
  const cost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  // Clamp to 6dp so the numeric column never overflows.
  return Math.max(0, Math.round(cost * 1_000_000) / 1_000_000);
}

// ---------------------------------------------------------------------------
// Per-plan daily synthesis quotas
// ---------------------------------------------------------------------------

export type PlanName = "user" | "pro" | "admin";

interface PlanQuotas {
  user: number;
  pro: number;
  admin: number;
}

const DEFAULT_PLAN_QUOTAS: PlanQuotas = { user: 5, pro: 200, admin: Number.POSITIVE_INFINITY };

function readPlanQuotas(): PlanQuotas {
  const raw = process.env.PLAN_QUOTAS;
  if (!raw) return DEFAULT_PLAN_QUOTAS;
  try {
    const parsed = JSON.parse(raw) as Partial<PlanQuotas>;
    return {
      user: Number.isFinite(parsed.user) ? Number(parsed.user) : DEFAULT_PLAN_QUOTAS.user,
      pro: Number.isFinite(parsed.pro) ? Number(parsed.pro) : DEFAULT_PLAN_QUOTAS.pro,
      admin:
        parsed.admin === null || parsed.admin === undefined
          ? DEFAULT_PLAN_QUOTAS.admin
          : Number(parsed.admin),
    };
  } catch (err) {
    logger.warn({ err, raw }, "Invalid PLAN_QUOTAS JSON; using defaults");
    return DEFAULT_PLAN_QUOTAS;
  }
}

export function getQuotaForPlan(plan: PlanName): number {
  const quotas = readPlanQuotas();
  return quotas[plan] ?? quotas.user;
}

// Plan column doesn't exist on the user row yet (Task #20). For now, derive
// a "plan" from existing fields: admins are unlimited, everyone else is
// the default `user` plan.
export function planForUser(user: { role: string; plan?: string | null } | undefined | null): PlanName {
  if (!user) return "user";
  if (user.role === "admin") return "admin";
  const p = (user.plan ?? "user").toLowerCase();
  if (p === "pro" || p === "admin" || p === "user") return p;
  return "user";
}

// ---------------------------------------------------------------------------
// Time helpers — quotas reset at the next UTC midnight.
// ---------------------------------------------------------------------------

export function utcDayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function nextUtcDayStart(now: Date = new Date()): Date {
  const d = utcDayStart(now);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function retryAfterSeconds(target: Date, now: Date = new Date()): number {
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

/**
 * Sentinel route value written exactly once per user-facing synthesis or
 * verify request. Quota counting filters on this so a single synthesis that
 * fans out to embedding + chat completion still counts as ONE quota slot,
 * not two — matching the "X/Y syntheses today" UI contract.
 */
export const SYNTH_REQUEST_ROUTE_PREFIX = "request:";

export async function getDailyUsageCountForUser(userId: string, now: Date = new Date()): Promise<number> {
  const start = utcDayStart(now);
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usageEventsTable)
      .where(
        and(
          eq(usageEventsTable.userId, userId),
          gte(usageEventsTable.createdAt, start),
          // Only count user-facing request markers, not every fan-out LLM call.
          sql`${usageEventsTable.route} LIKE ${SYNTH_REQUEST_ROUTE_PREFIX + "%"}`,
        ),
      );
    return row?.count ?? 0;
  } catch (err) {
    logger.warn({ err, userId }, "getDailyUsageCountForUser failed; defaulting to 0");
    return 0;
  }
}

/**
 * Insert a single zero-cost row that marks one user-facing synth/verify
 * request. Called from the route handler AFTER quota+budget pass, so the
 * count reflects requests we actually agreed to serve.
 */
export async function recordSynthRequest(
  userId: string,
  routeTag: "synthesize" | "verify",
  requestId: string | null,
): Promise<void> {
  void persistUsageRow({
    userId,
    route: `${SYNTH_REQUEST_ROUTE_PREFIX}${routeTag}`,
    model: "n/a",
    requestId: requestId ?? null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    failed: false,
  });
}

export async function getDailyTotalCostUsd(now: Date = new Date()): Promise<number> {
  const start = utcDayStart(now);
  try {
    const [row] = await db
      .select({ total: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text` })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, start));
    return Number(row?.total ?? 0);
  } catch (err) {
    logger.warn({ err }, "getDailyTotalCostUsd failed; defaulting to 0");
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Global LLM budget cap
// ---------------------------------------------------------------------------

export function getDailyBudgetUsd(): number {
  const raw = process.env.LLM_DAILY_BUDGET_USD;
  if (!raw) return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

interface BudgetCacheEntry {
  total: number;
  fetchedAtMs: number;
}
let budgetCache: BudgetCacheEntry | null = null;
const BUDGET_CACHE_TTL_MS = 30_000;

interface ResetState {
  // The UTC-day-start (ms) for which the admin reset applies.
  forDayStartMs: number;
}
let lastResetState: ResetState | null = null;

export function _resetUsageStateForTests(): void {
  budgetCache = null;
  lastResetState = null;
}

async function getCachedDailyTotal(now: Date): Promise<number> {
  const nowMs = now.getTime();
  if (budgetCache && nowMs - budgetCache.fetchedAtMs < BUDGET_CACHE_TTL_MS) {
    return budgetCache.total;
  }
  const total = await getDailyTotalCostUsd(now);
  budgetCache = { total, fetchedAtMs: nowMs };
  return total;
}

export interface BudgetStatus {
  exhausted: boolean;
  spendUsd: number;
  capUsd: number | null;
  retryAfterUtc: string;
  retryAfterSeconds: number;
}

export async function getBudgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  const cap = getDailyBudgetUsd();
  const dayStartMs = utcDayStart(now).getTime();
  const overrideActive = lastResetState?.forDayStartMs === dayStartMs;

  let spend = await getCachedDailyTotal(now);
  // The admin reset ignores existing spend for the rest of the UTC day.
  if (overrideActive) spend = 0;

  const exhausted = Number.isFinite(cap) && spend >= cap;
  const next = nextUtcDayStart(now);
  return {
    exhausted,
    spendUsd: spend,
    capUsd: Number.isFinite(cap) ? cap : null,
    retryAfterUtc: next.toISOString(),
    retryAfterSeconds: retryAfterSeconds(next, now),
  };
}

export function adminResetBudgetForToday(now: Date = new Date()): void {
  lastResetState = { forDayStartMs: utcDayStart(now).getTime() };
  budgetCache = { total: 0, fetchedAtMs: now.getTime() };
  logger.info({ at: now.toISOString() }, "Admin reset of LLM daily budget cap");
}

// ---------------------------------------------------------------------------
// recordLlmCall — single chokepoint for ALL OpenAI calls
// ---------------------------------------------------------------------------

interface OpenAIUsage {
  prompt_tokens?: number;
  input_tokens?: number;
  completion_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface RecordLlmCallContext {
  userId?: string | null;
  route: string;
  model: string;
  requestId?: string | null;
  /** Manual override when the wrapped call doesn't expose `usage` (e.g. streaming). */
  inputTokens?: number;
  outputTokens?: number;
}

interface MaybeUsageHolder {
  usage?: OpenAIUsage | null;
}

function extractUsage(result: unknown): OpenAIUsage | null {
  if (!result || typeof result !== "object") return null;
  const u = (result as MaybeUsageHolder).usage;
  return u && typeof u === "object" ? u : null;
}

/**
 * Wraps a single OpenAI call. Times it, extracts token counts from the
 * `usage` property when present (or accepts manual overrides via `ctx`),
 * computes USD cost from a per-model price map, and inserts a `usage_events`
 * row. DB write failures are swallowed so accounting never breaks the
 * user-facing call. Re-throws any error from the wrapped function.
 */
export async function recordLlmCall<T>(
  fn: () => Promise<T>,
  ctx: RecordLlmCallContext,
): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    // Best-effort: still record a zero-cost row so we can see failures in /admin/usage.
    void persistUsageRow({ ...ctx, inputTokens: 0, outputTokens: 0, costUsd: 0, failed: true });
    throw err;
  }

  const usage = extractUsage(result);
  const inputTokens = ctx.inputTokens ?? usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  const outputTokens = ctx.outputTokens ?? usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  const costUsd = computeCostUsd(ctx.model, inputTokens, outputTokens);
  void persistUsageRow({ ...ctx, inputTokens, outputTokens, costUsd, failed: false });
  return result;
}

interface PersistRow extends RecordLlmCallContext {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  failed: boolean;
}

async function persistUsageRow(row: PersistRow): Promise<void> {
  try {
    await db.insert(usageEventsTable).values({
      userId: row.userId ?? null,
      route: row.route,
      model: row.model,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd.toFixed(6),
      requestId: row.requestId ?? null,
      failed: row.failed,
    });
    // Invalidate the budget cache so the next request sees fresh spend.
    budgetCache = null;
  } catch (err) {
    logger.warn({ err, row }, "Failed to insert usage_events row (non-fatal)");
  }
}

// ---------------------------------------------------------------------------
// Middlewares
// ---------------------------------------------------------------------------

export interface UsageMeResponse {
  plan: PlanName;
  syntheses: {
    todayCount: number;
    dailyLimit: number | null;
    remaining: number | null;
    resetAtUtc: string;
  };
  budget: BudgetStatus;
}

export async function buildUsageMe(userId: string, plan: PlanName, now: Date = new Date()): Promise<UsageMeResponse> {
  const todayCount = await getDailyUsageCountForUser(userId, now);
  const limit = getQuotaForPlan(plan);
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - todayCount) : null;
  const dailyLimit = Number.isFinite(limit) ? limit : null;
  const budget = await getBudgetStatus(now);
  return {
    plan,
    syntheses: {
      todayCount,
      dailyLimit,
      remaining,
      resetAtUtc: nextUtcDayStart(now).toISOString(),
    },
    budget,
  };
}

function sendQuotaExceeded(res: Response, retryAfterDate: Date): void {
  const seconds = retryAfterSeconds(retryAfterDate);
  res.setHeader("Retry-After", String(seconds));
  res.status(429).json({
    code: "QUOTA_EXCEEDED",
    message:
      "Daily synthesis quota reached for your plan. Quota resets at the start of the next UTC day.",
    retryAfter: seconds,
    retryAfterUtc: retryAfterDate.toISOString(),
  });
}

function sendBudgetExhausted(res: Response, status: BudgetStatus): void {
  res.setHeader("Retry-After", String(status.retryAfterSeconds));
  res.status(503).json({
    code: "BUDGET_EXHAUSTED",
    message:
      "The site has hit its daily AI spend limit. Service will resume at the next UTC day.",
    retryAfter: status.retryAfterSeconds,
    retryAfterUtc: status.retryAfterUtc,
  });
}

// NOTE on race conditions: quota and budget enforcement are read-before-write.
// usage_events are persisted asynchronously via `void persistUsageRow(...)`,
// so a small burst of concurrent requests from the same user *can* slip past
// the quota check before earlier events are recorded. The worst-case bypass
// is bounded by:
//   - the per-route synthesis rate limit (default 10/min) and
//   - the per-user concurrent SSE cap (default 3 streams).
// Combined, these cap real-world abuse to a handful of extra calls per minute,
// which is acceptable for v1. Closing the window fully requires a Redis or
// Postgres-backed atomic counter (Task #18 — horizontal scale).
export const enforceSynthesisQuota: RequestHandler = async (req, res, next) => {
  const user = req.currentUser;
  if (!user) {
    // Quota is meaningless without a user; let downstream auth middleware reject.
    next();
    return;
  }
  const plan = planForUser(user);
  const limit = getQuotaForPlan(plan);
  if (!Number.isFinite(limit)) {
    next();
    return;
  }
  const todayCount = await getDailyUsageCountForUser(user.id);
  if (todayCount >= limit) {
    sendQuotaExceeded(res, nextUtcDayStart());
    return;
  }
  next();
};

export const enforceBudget: RequestHandler = async (_req, res, next) => {
  const status = await getBudgetStatus();
  if (status.exhausted) {
    sendBudgetExhausted(res, status);
    return;
  }
  next();
};

// SSE-specific budget check that emits an SSE error frame instead of a JSON
// body, since headers may already be sent by the time we'd want to reject.
export async function preflightBudgetForSse(_req: Request, res: Response): Promise<boolean> {
  const status = await getBudgetStatus();
  if (status.exhausted) {
    sendBudgetExhausted(res, status);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Aggregations for /api/admin/usage
// ---------------------------------------------------------------------------

export interface AdminUsageSummary {
  todayUsd: number;
  todayCount: number;
  capUsd: number | null;
  exhausted: boolean;
  byDay: { day: string; costUsd: number; calls: number }[];
  byRoute: { route: string; costUsd: number; calls: number }[];
  byUser: { userId: string | null; costUsd: number; calls: number }[];
}

export async function buildAdminUsage(): Promise<AdminUsageSummary> {
  const now = new Date();
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - 14); // last 14 days
  since.setUTCHours(0, 0, 0, 0);

  const status = await getBudgetStatus(now);

  let byDay: AdminUsageSummary["byDay"] = [];
  let byRoute: AdminUsageSummary["byRoute"] = [];
  let byUser: AdminUsageSummary["byUser"] = [];
  let todayCount = 0;

  try {
    const dayRows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${usageEventsTable.createdAt}), 'YYYY-MM-DD')`,
        costUsd: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text`,
        calls: sql<number>`count(*)::int`,
      })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, since))
      .groupBy(sql`date_trunc('day', ${usageEventsTable.createdAt})`)
      .orderBy(desc(sql`date_trunc('day', ${usageEventsTable.createdAt})`));
    byDay = dayRows.map((r) => ({ day: r.day, costUsd: Number(r.costUsd), calls: r.calls }));

    const routeRows = await db
      .select({
        route: usageEventsTable.route,
        costUsd: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text`,
        calls: sql<number>`count(*)::int`,
      })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, since))
      .groupBy(usageEventsTable.route)
      .orderBy(desc(sql`SUM(${usageEventsTable.costUsd})`));
    byRoute = routeRows.map((r) => ({ route: r.route, costUsd: Number(r.costUsd), calls: r.calls }));

    const userRows = await db
      .select({
        userId: usageEventsTable.userId,
        costUsd: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text`,
        calls: sql<number>`count(*)::int`,
      })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, since))
      .groupBy(usageEventsTable.userId)
      .orderBy(desc(sql`SUM(${usageEventsTable.costUsd})`))
      .limit(50);
    byUser = userRows.map((r) => ({
      userId: r.userId ?? null,
      costUsd: Number(r.costUsd),
      calls: r.calls,
    }));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(usageEventsTable)
      .where(gte(usageEventsTable.createdAt, utcDayStart(now)));
    todayCount = count ?? 0;
  } catch (err) {
    logger.warn({ err }, "buildAdminUsage aggregation failed");
  }

  return {
    todayUsd: status.spendUsd,
    todayCount,
    capUsd: status.capUsd,
    exhausted: status.exhausted,
    byDay,
    byRoute,
    byUser,
  };
}

// Re-exported for tests: signature kept stable for unit testing.
export const __test = { utcDayStart, nextUtcDayStart };
// Mark unused params as referenced for stricter eslint configs.
void ((_: NextFunction) => undefined);
