import { logger } from "./logger";
import { createHash } from "crypto";

let sentryModule: typeof import("@sentry/node") | null = null;
let sentryEnabled = false;

const PII_KEYS = new Set([
  "email",
  "password",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "claim",
  "claimText",
  "question",
  "q",
  "pubmedQuery",
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k.toLowerCase())) {
        out[k] = "[scrubbed]";
      } else {
        out[k] = scrub(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string" && /[\w.+-]+@[\w-]+\.[\w.-]+/.test(value)) {
    return value.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  }
  return value;
}

export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry disabled (SENTRY_DSN not set)");
    return;
  }
  try {
    sentryModule = await import("@sentry/node");
    sentryModule.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.BUILD_SHA ?? "dev",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend(event) {
        if (event.request) {
          // Strip query string entirely — params like ?q=<question> can leak
          // user content. Keep just the pathname.
          if (typeof event.request.url === "string") {
            event.request.url = event.request.url.split("?")[0];
          }
          if (event.request.query_string) {
            event.request.query_string = "[scrubbed]";
          }
          event.request = scrub(event.request) as typeof event.request;
        }
        if (typeof event.transaction === "string") {
          event.transaction = event.transaction.split("?")[0];
        }
        if (event.user?.email) {
          event.user.email = "[scrubbed]";
        }
        if (event.user?.ip_address) {
          event.user.ip_address = createHash("sha256")
            .update(event.user.ip_address)
            .digest("hex")
            .slice(0, 12);
        }
        if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
        if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
        return event;
      },
    });
    sentryEnabled = true;
    logger.info({ release: process.env.BUILD_SHA ?? "dev" }, "Sentry initialized");
  } catch (err) {
    logger.warn({ err }, "Failed to initialize Sentry (module not installed?)");
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>): string | undefined {
  if (!sentryEnabled || !sentryModule) return undefined;
  try {
    return sentryModule.captureException(err, context ? { extra: scrub(context) as Record<string, unknown> } : undefined);
  } catch {
    return undefined;
  }
}

export function setRequestContext(ctx: { requestId?: string; userId?: string | null; route?: string }): void {
  if (!sentryEnabled || !sentryModule) return;
  try {
    const scope = sentryModule.getCurrentScope();
    if (ctx.requestId) scope.setTag("request_id", ctx.requestId);
    if (ctx.route) scope.setTag("route", ctx.route);
    scope.setUser({ id: ctx.userId ?? "anon" });
  } catch {
    // noop
  }
}

export function isSentryEnabled(): boolean {
  return sentryEnabled;
}
