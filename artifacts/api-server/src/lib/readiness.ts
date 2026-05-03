import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

interface ReadinessCheck {
  db: { ok: boolean; latencyMs?: number; error?: string };
  openai: { ok: boolean; latencyMs?: number; error?: string; configured: boolean };
}

interface ReadinessSnapshot {
  ready: boolean;
  checks: ReadinessCheck;
  checkedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cached: ReadinessSnapshot | null = null;
let inflight: Promise<ReadinessSnapshot> | null = null;

async function pingDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const t = performance.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latencyMs: performance.now() - t };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function pingOpenai(): Promise<{ ok: boolean; latencyMs?: number; error?: string; configured: boolean }> {
  if (!process.env.OPENAI_API_KEY) {
    // Per spec, /health/ready requires OpenAI reachability. When unconfigured,
    // ok=false so the probe returns 503 — the caller knows to provision the
    // key. (Alerts also key off this.) STRICT_READINESS=false relaxes for dev.
    if (process.env.STRICT_READINESS === "false") {
      return { ok: true, configured: false };
    }
    return { ok: false, configured: false, error: "OPENAI_API_KEY not configured" };
  }
  const t = performance.now();
  try {
    const res = await fetch("https://api.openai.com/v1/models?limit=1", {
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return { ok: false, configured: true, error: `HTTP ${res.status}` };
    }
    return { ok: true, configured: true, latencyMs: performance.now() - t };
  } catch (err) {
    return { ok: false, configured: true, error: err instanceof Error ? err.message : String(err) };
  }
}

async function compute(): Promise<ReadinessSnapshot> {
  const [dbRes, openaiRes] = await Promise.all([pingDb(), pingOpenai()]);
  const checks: ReadinessCheck = { db: dbRes, openai: openaiRes };
  const ready = dbRes.ok && openaiRes.ok;
  return { ready, checks, checkedAt: Date.now() };
}

export async function getReadiness(): Promise<ReadinessSnapshot> {
  const now = Date.now();
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = compute()
    .then((snap) => {
      cached = snap;
      return snap;
    })
    .catch((err) => {
      logger.warn({ err }, "readiness compute failed");
      const snap: ReadinessSnapshot = {
        ready: false,
        checks: {
          db: { ok: false, error: "compute failed" },
          openai: { ok: false, configured: !!process.env.OPENAI_API_KEY, error: "compute failed" },
        },
        checkedAt: Date.now(),
      };
      cached = snap;
      return snap;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function isReadyCached(): { ready: boolean; checks: ReadinessCheck | null } {
  if (!cached) return { ready: true, checks: null };
  return { ready: cached.ready, checks: cached.checks };
}

export function _resetReadinessForTests(): void {
  cached = null;
  inflight = null;
}
