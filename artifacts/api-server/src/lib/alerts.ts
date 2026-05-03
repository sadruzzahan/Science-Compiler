import { db, alertsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getRecentErrorRate } from "./metrics";
import { getBudgetStatus } from "./usage";
import { getReadiness } from "./readiness";

const CHECK_INTERVAL_MS = 30_000;
const ERROR_RATE_THRESHOLD = 0.05;
const ERROR_RATE_MIN_REQUESTS = 20;
const BUDGET_THRESHOLD = 0.8;
const READY_FAILING_THRESHOLD_MS = 2 * 60_000;
const NOTIFY_COOLDOWN_MS = 30 * 60_000;

// In-memory cooldown ledger keyed by `${kind}:${event}` to suppress repeat
// notifications within the cooldown window. Persisted notifiedAt on the row
// is the source of truth across restarts for active alerts.
const lastNotifiedAt = new Map<string, number>();

let readinessFailingSince: number | null = null;
let timer: NodeJS.Timeout | null = null;

export type AlertKind = "error_rate" | "llm_budget" | "readiness";

interface AlertCheck {
  kind: AlertKind;
  message: string;
  payload: Record<string, unknown>;
  active: boolean;
  severity: "warning" | "critical";
}

async function evaluate(): Promise<AlertCheck[]> {
  const results: AlertCheck[] = [];

  const er = getRecentErrorRate(5 * 60_000);
  results.push({
    kind: "error_rate",
    message: `Error rate ${(er.rate * 100).toFixed(1)}% over 5min (${er.errors}/${er.requests})`,
    payload: { ...er, threshold: ERROR_RATE_THRESHOLD, windowMin: 5 },
    active: er.requests >= ERROR_RATE_MIN_REQUESTS && er.rate > ERROR_RATE_THRESHOLD,
    severity: "critical",
  });

  try {
    const b = await getBudgetStatus();
    const cap = b.capUsd ?? 0;
    const utilization = cap > 0 ? b.spendUsd / cap : 0;
    results.push({
      kind: "llm_budget",
      message: `Daily LLM spend ${(utilization * 100).toFixed(1)}% of cap ($${b.spendUsd.toFixed(2)} / $${cap.toFixed(2)})`,
      payload: { ...b, utilization, threshold: BUDGET_THRESHOLD },
      active: cap > 0 && utilization > BUDGET_THRESHOLD,
      severity: "warning",
    });
  } catch (err) {
    logger.warn({ err }, "alert: budget probe failed");
  }

  const ready = await getReadiness();
  if (!ready.ready) {
    if (readinessFailingSince == null) readinessFailingSince = Date.now();
  } else {
    readinessFailingSince = null;
  }
  const failingFor = readinessFailingSince ? Date.now() - readinessFailingSince : 0;
  results.push({
    kind: "readiness",
    message: `Readiness probe failing for ${Math.round(failingFor / 1000)}s`,
    payload: { ready: ready.ready, checks: ready.checks, failingMs: failingFor },
    active: !ready.ready && failingFor > READY_FAILING_THRESHOLD_MS,
    severity: "critical",
  });

  return results;
}

async function getActiveAlertId(kind: AlertKind): Promise<number | null> {
  const rows = await db
    .select({ id: alertsTable.id })
    .from(alertsTable)
    .where(and(eq(alertsTable.kind, kind), isNull(alertsTable.resolvedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
}

type Transporter = { sendMail: (opts: Record<string, unknown>) => Promise<unknown> };
let mailer: Transporter | null = null;
let mailerInitTried = false;

async function getMailer(): Promise<Transporter | null> {
  if (mailer || mailerInitTried) return mailer;
  mailerInitTried = true;
  if (!process.env.SMTP_URL) return null;
  try {
    const nm = (await import("nodemailer")) as unknown as {
      createTransport: (url: string) => Transporter;
    };
    mailer = nm.createTransport(process.env.SMTP_URL);
    logger.info("alert email transport initialized");
  } catch (err) {
    logger.warn({ err }, "failed to init nodemailer transport");
  }
  return mailer;
}

async function notify(kind: AlertKind, event: "fired" | "resolved", payload: Record<string, unknown>): Promise<void> {
  const cooldownKey = `${kind}:${event}`;
  const last = lastNotifiedAt.get(cooldownKey) ?? 0;
  if (Date.now() - last < NOTIFY_COOLDOWN_MS) {
    logger.debug({ kind, event, sinceLastMs: Date.now() - last }, "alert notify suppressed by cooldown");
    return;
  }
  lastNotifiedAt.set(cooldownKey, Date.now());

  const webhook = process.env.ALERT_WEBHOOK_URL;
  const email = process.env.ALERT_EMAIL_TO;
  const subject = `[${event}] ${kind} — ${(payload.message as string | undefined) ?? "alert"}`;

  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, kind, ...payload }),
      });
    } catch (err) {
      logger.warn({ err }, "alert webhook delivery failed");
    }
  }
  if (email) {
    const t = await getMailer();
    if (!t) {
      logger.warn({ email, kind, event }, "alert email skipped: SMTP_URL not configured");
    } else {
      try {
        await t.sendMail({
          from: process.env.ALERT_EMAIL_FROM ?? "alerts@science-compiler.local",
          to: email,
          subject,
          text: JSON.stringify({ event, kind, ...payload }, null, 2),
        });
      } catch (err) {
        logger.warn({ err }, "alert email delivery failed");
      }
    }
  }
}

export async function runAlertCheck(): Promise<void> {
  let checks: AlertCheck[];
  try {
    checks = await evaluate();
  } catch (err) {
    logger.warn({ err }, "alert evaluation failed");
    return;
  }

  for (const c of checks) {
    try {
      const existingId = await getActiveAlertId(c.kind);
      if (c.active && !existingId) {
        const [row] = await db
          .insert(alertsTable)
          .values({ kind: c.kind, severity: c.severity, message: c.message, payload: c.payload })
          .returning({ id: alertsTable.id });
        logger.warn({ kind: c.kind, message: c.message, alertId: row?.id }, "alert fired");
        await notify(c.kind, "fired", { severity: c.severity, message: c.message, payload: c.payload });
        if (row?.id) {
          await db.update(alertsTable).set({ notifiedAt: new Date() }).where(eq(alertsTable.id, row.id));
        }
      } else if (!c.active && existingId) {
        await db.update(alertsTable).set({ resolvedAt: new Date() }).where(eq(alertsTable.id, existingId));
        logger.info({ kind: c.kind, alertId: existingId }, "alert resolved");
        await notify(c.kind, "resolved", { message: c.message, payload: c.payload });
      }
    } catch (err) {
      logger.warn({ err, kind: c.kind }, "alert persistence failed");
    }
  }
}

export function startAlertChecker(): void {
  if (timer) return;
  timer = setInterval(() => { void runAlertCheck(); }, CHECK_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopAlertChecker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function listRecentAlerts(limit = 50) {
  return db
    .select()
    .from(alertsTable)
    .orderBy(sql`${alertsTable.firedAt} DESC`)
    .limit(limit);
}
