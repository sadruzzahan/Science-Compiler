import { runIngestion } from "./ingestionWorker";
import { logger } from "./logger";

const INTERVAL_MS = parseInt(process.env.INGESTION_INTERVAL_MS ?? String(6 * 60 * 60 * 1000));

let schedulerHandle: ReturnType<typeof setInterval> | null = null;
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
}

export function stopIngestionScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    logger.info("Ingestion scheduler stopped");
  }
}

export function isIngestionRunning(): boolean {
  return isRunning;
}
