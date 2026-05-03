import * as Sentry from "@sentry/react";

const SENSITIVE_KEYS = ["email", "password", "token", "authorization", "cookie", "claim", "claimText", "question", "q"];

let lastRequestId: string | null = null;

export function setLastRequestId(id: string | null): void {
  lastRequestId = id;
}

export function getLastRequestId(): string | null {
  return lastRequestId;
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
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

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: (import.meta.env.VITE_BUILD_SHA as string | undefined) ?? "dev",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) event.request = scrub(event.request) as typeof event.request;
      if (event.user?.email) event.user.email = "[scrubbed]";
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      return event;
    },
  });
  initialized = true;
}

export { Sentry };
