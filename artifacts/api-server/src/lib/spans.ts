import { db, pipelineSpansTable } from "@workspace/db";
import { logger } from "./logger";

export interface SpanContext {
  pipeline: string;
  requestId?: string | null;
  userId?: string | null;
}

export async function withSpan<T>(
  ctx: SpanContext,
  spanName: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const start = performance.now();
  let failed = 0;
  try {
    const result = await fn();
    return result;
  } catch (err) {
    failed = 1;
    throw err;
  } finally {
    const durationMs = performance.now() - start;
    logger.debug(
      { pipeline: ctx.pipeline, spanName, durationMs, requestId: ctx.requestId, failed },
      "pipeline.span",
    );
    // Fire and forget — never block the caller on telemetry persistence.
    void persistSpan({
      pipeline: ctx.pipeline,
      spanName,
      durationMs,
      requestId: ctx.requestId ?? null,
      userId: ctx.userId ?? null,
      failed,
      metadata: metadata ?? null,
    });
  }
}

async function persistSpan(row: {
  pipeline: string;
  spanName: string;
  durationMs: number;
  requestId: string | null;
  userId: string | null;
  failed: number;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(pipelineSpansTable).values(row);
  } catch (err) {
    logger.warn({ err }, "pipeline span persist failed");
  }
}
