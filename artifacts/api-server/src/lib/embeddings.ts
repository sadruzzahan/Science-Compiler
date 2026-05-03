import OpenAI from "openai";
import { db, claimsTable } from "@workspace/db";
import { eq, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { recordLlmCall, type RecordLlmCallContext } from "./usage";

/** Subset of the recordLlmCall context that callers may forward. */
export type EmbedRecordCtx = Partial<Pick<RecordLlmCallContext, "userId" | "requestId" | "route">>;

const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

export function isEmbeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Generate an embedding vector for the given text.
 * Returns null if OPENAI_API_KEY is missing or the API call fails.
 * Callers should fall back to keyword search when null is returned.
 */
export async function embedText(text: string, ctx?: EmbedRecordCtx): Promise<number[] | null> {
  const client = getClient();
  if (!client) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const response = await recordLlmCall(
      () =>
        client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: trimmed.slice(0, 8000),
        }),
      {
        route: ctx?.route ?? "embeddings.embedText",
        model: EMBEDDING_MODEL,
        userId: ctx?.userId ?? null,
        requestId: ctx?.requestId ?? null,
      },
    );
    const vec = response.data[0]?.embedding;
    if (!vec || vec.length !== EMBEDDING_DIMENSIONS) {
      logger.warn({ len: vec?.length }, "Unexpected embedding dimension");
      return null;
    }
    return vec;
  } catch (err) {
    logger.warn({ err }, "embedText failed (will fall back to keyword search)");
    return null;
  }
}

/** Format a number[] as the pgvector literal `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

/**
 * Generate and persist an embedding for a claim. Best-effort: logs and returns
 * false on any failure so ingestion never fails because of embedding issues.
 */
export async function embedAndStoreClaim(claimId: number, text: string): Promise<boolean> {
  const vec = await embedText(text);
  if (!vec) return false;
  try {
    await db
      .update(claimsTable)
      .set({ embedding: sql`${toVectorLiteral(vec)}::vector` })
      .where(eq(claimsTable.id, claimId));
    return true;
  } catch (err) {
    logger.warn({ err, claimId }, "Failed to persist claim embedding");
    return false;
  }
}

/**
 * Backfill embeddings for any claims that don't have one yet.
 * Returns counts; intended for an admin-triggered job.
 */
export async function backfillClaimEmbeddings(
  limit = 500,
): Promise<{ processed: number; succeeded: number; failed: number; remaining: number }> {
  if (!isEmbeddingsAvailable()) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
  }
  const rows = await db
    .select({ id: claimsTable.id, claimText: claimsTable.claimText })
    .from(claimsTable)
    .where(isNull(claimsTable.embedding))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    const ok = await embedAndStoreClaim(row.id, row.claimText);
    if (ok) succeeded++;
    else failed++;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(claimsTable)
    .where(isNull(claimsTable.embedding));

  return { processed: rows.length, succeeded, failed, remaining: count };
}
