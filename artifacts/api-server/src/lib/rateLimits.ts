import type { RequestHandler, Request, Response } from "express";
import { logger } from "./logger";

// In-memory sliding-window-ish token bucket.
//
// NOTE: This is intentionally process-local. The rest of the system (e.g. the
// SSE concurrency cap in `sseCap.ts`) is also single-instance, so all rate
// limits are consistent across the codebase. When we scale horizontally
// (Task #18) we'll switch to a Redis or Postgres-backed store.
interface Bucket {
  count: number;
  windowStartMs: number;
}

class FixedWindowLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly name: string,
  ) {}

  /** Returns null if allowed, or remaining seconds until the window resets if denied. */
  hit(key: string, now: number = Date.now()): number | null {
    if (this.max <= 0) return null;
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartMs >= this.windowMs) {
      bucket = { count: 0, windowStartMs: now };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > this.max) {
      const retryMs = this.windowMs - (now - bucket.windowStartMs);
      return Math.max(1, Math.ceil(retryMs / 1000));
    }
    return null;
  }

  /** Periodically prune empty/expired buckets to keep memory bounded. */
  prune(now: number = Date.now()): void {
    for (const [k, b] of this.buckets.entries()) {
      if (now - b.windowStartMs >= this.windowMs * 2) this.buckets.delete(k);
    }
  }

  reset(): void {
    this.buckets.clear();
  }

  get label(): string {
    return this.name;
  }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const ONE_MIN = 60_000;

// Limits configurable via env per Task #11 spec.
const generalLimiter = new FixedWindowLimiter(
  ONE_MIN,
  envInt("RATE_LIMIT_GENERAL_PER_MIN", 60),
  "general",
);
const synthLimiter = new FixedWindowLimiter(
  ONE_MIN,
  envInt("RATE_LIMIT_SYNTH_PER_MIN", 10),
  "synth",
);
const ingestionLimiter = new FixedWindowLimiter(
  ONE_MIN,
  envInt("RATE_LIMIT_INGESTION_PER_MIN", 5),
  "ingestion",
);
const authLimiter = new FixedWindowLimiter(
  ONE_MIN,
  envInt("RATE_LIMIT_AUTH_PER_MIN", 30),
  "auth",
);

const ALL_LIMITERS = [generalLimiter, synthLimiter, ingestionLimiter, authLimiter];

// Periodic prune every 2 minutes to bound memory.
setInterval(() => {
  for (const l of ALL_LIMITERS) l.prune();
}, 2 * ONE_MIN).unref?.();

function keyFor(req: Request): string {
  const userId = req.currentUser?.id;
  if (userId) return `u:${userId}`;
  // Express 5: req.ip respects `trust proxy`. Fall back to remoteAddress.
  return `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

function send429(res: Response, code: string, message: string, retryAfter: number): void {
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ code, message, retryAfter });
}

function makeMiddleware(limiter: FixedWindowLimiter, code: string, message: string): RequestHandler {
  return (req, res, next) => {
    try {
      const k = keyFor(req);
      const retry = limiter.hit(k);
      if (retry !== null) {
        logger.debug({ key: k, limiter: limiter.label, retry }, "rate limit hit");
        send429(res, code, message, retry);
        return;
      }
      next();
    } catch (err) {
      logger.warn({ err }, "rate limiter error (allowing request)");
      next();
    }
  };
}

export const generalRateLimit = makeMiddleware(
  generalLimiter,
  "RATE_LIMITED",
  "Too many requests. Please slow down.",
);
export const synthesisRateLimit = makeMiddleware(
  synthLimiter,
  "RATE_LIMITED_SYNTH",
  "Too many synthesis/verification requests. Please slow down.",
);
export const ingestionRateLimit = makeMiddleware(
  ingestionLimiter,
  "RATE_LIMITED_INGESTION",
  "Too many ingestion requests. Please slow down.",
);
export const authRateLimit = makeMiddleware(
  authLimiter,
  "RATE_LIMITED_AUTH",
  "Too many authentication requests. Please try again shortly.",
);

export function _resetRateLimitsForTests(): void {
  for (const l of ALL_LIMITERS) l.reset();
}
