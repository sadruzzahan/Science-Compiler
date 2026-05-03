import { runIngestion } from "./ingestionWorker";
import { logger } from "./logger";
import { db, claimsTable, claimReviewsTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";

const INTERVAL_MS = parseInt(process.env.INGESTION_INTERVAL_MS ?? String(6 * 60 * 60 * 1000));
const REVIEW_SWEEP_INTERVAL_MS = parseInt(process.env.REVIEW_SWEEP_INTERVAL_MS ?? String(24 * 60 * 60 * 1000));
const AUTO_APPROVE_AGE_DAYS = parseInt(process.env.AUTO_APPROVE_AGE_DAYS ?? "7");
const AUTO_APPROVE_CONFIDENCE = parseFloat(process.env.AUTO_APPROVE_CONFIDENCE ?? "0.9");

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
let reviewSweepHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function startIngestionScheduler(): void {
  if (schedulerHandle) return;

  logger.info({ intervalMs: INTERVAL_MS }, "Ingestion scheduler started");

  async function tick() {
    if (isRunning) {
      logger.info("Ingestion already running; skipping scheduled tick");
      return;
    }
    isRunning = true;
    logger.info("Running scheduled ingestion");
    try {
      const results = await runIngestion("scheduler");
      const total = results.reduce((s, r) => ({
        papers: s.papers + r.papersProcessed,
        claims: s.claims + r.claimsExtracted,
        errors: s.errors + r.errorsCount,
      }), { papers: 0, claims: 0, errors: 0 });
      logger.info(total, "Scheduled ingestion completed");
    } catch (err) {
      logger.error({ err }, "Scheduled ingestion failed");
    } finally {
      isRunning = false;
    }
  }

  schedulerHandle = setInterval(tick, INTERVAL_MS);

  // Daily review-queue sweep: auto-approves pending claims that are old
  // enough, never been flagged, and confident enough. Audited via claim_reviews.
  if (!reviewSweepHandle) {
    reviewSweepHandle = setInterval(() => {
      void runReviewQueueSweep().catch(err => logger.error({ err }, "Review queue sweep failed"));
    }, REVIEW_SWEEP_INTERVAL_MS);
  }
}

export function stopIngestionScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    logger.info("Ingestion scheduler stopped");
  }
  if (reviewSweepHandle) {
    clearInterval(reviewSweepHandle);
    reviewSweepHandle = null;
  }
}

export function isIngestionRunning(): boolean {
  return isRunning;
}

export function acquireIngestionLock(): boolean {
  if (isRunning) return false;
  isRunning = true;
  return true;
}

export function releaseIngestionLock(): void {
  isRunning = false;
}

export async function runReviewQueueSweep(): Promise<{ approved: number }> {
  const cutoff = new Date(Date.now() - AUTO_APPROVE_AGE_DAYS * 24 * 60 * 60 * 1000);
  const eligible = await db.select({ id: claimsTable.id, claimText: claimsTable.claimText, confidence: claimsTable.confidence })
    .from(claimsTable)
    .where(and(
      eq(claimsTable.status, "pending"),
      eq(claimsTable.flagCount, 0),
      lte(claimsTable.createdAt, cutoff),
      sql`${claimsTable.confidence} >= ${AUTO_APPROVE_CONFIDENCE}`,
    ));

  if (eligible.length === 0) return { approved: 0 };

  for (const c of eligible) {
    await db.update(claimsTable).set({ status: "approved" }).where(eq(claimsTable.id, c.id));
    await db.insert(claimReviewsTable).values({
      claimId: c.id,
      reviewerId: null,
      decision: "auto-approve",
      notes: `Confidence ${c.confidence.toFixed(2)} ≥ ${AUTO_APPROVE_CONFIDENCE}, no flags after ${AUTO_APPROVE_AGE_DAYS}d`,
    });
  }
  logger.info({ count: eligible.length }, "Auto-approved pending claims");
  return { approved: eligible.length };
}
