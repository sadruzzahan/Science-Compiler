import { Router, type IRouter } from "express";
import { desc, eq, and, gte, lte, sql, or } from "drizzle-orm";
import { db, ingestionRunsTable, ingestionConfigsTable, topicsTable, papersTable, claimsTable, claimReviewsTable } from "@workspace/db";
import { getAdapter } from "../lib/sources";
import { runIngestion } from "../lib/ingestionWorker";
import { acquireIngestionLock, releaseIngestionLock } from "../lib/ingestionScheduler";
import { backfillClaimEmbeddings, isEmbeddingsAvailable } from "../lib/embeddings";
import { logger } from "../lib/logger";
import { z } from "zod";
import { ingestionRateLimit } from "../lib/rateLimits";

const MAX_INGESTION_QUERY_LEN = 200;

const router: IRouter = Router();

router.get("/admin/ingestion-runs", async (req, res): Promise<void> => {
  const limitRaw = parseInt(String(req.query.limit ?? "50"));
  const limit = isNaN(limitRaw) ? 50 : Math.min(limitRaw, 200);
  const runs = await db
    .select({
      run: ingestionRunsTable,
      topicName: topicsTable.name,
    })
    .from(ingestionRunsTable)
    .leftJoin(topicsTable, eq(ingestionRunsTable.topicId, topicsTable.id))
    .orderBy(desc(ingestionRunsTable.startedAt))
    .limit(limit);

  res.json(runs.map(r => ({
    ...r.run,
    startedAt: r.run.startedAt.toISOString(),
    completedAt: r.run.completedAt?.toISOString() ?? null,
    createdAt: r.run.createdAt.toISOString(),
    topicName: r.topicName ?? null,
  })));
});

router.get("/admin/ingestion-runs/:id/results", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [runRow] = await db
    .select({ run: ingestionRunsTable, topicName: topicsTable.name })
    .from(ingestionRunsTable)
    .leftJoin(topicsTable, eq(ingestionRunsTable.topicId, topicsTable.id))
    .where(eq(ingestionRunsTable.id, id))
    .limit(1);

  if (!runRow) { res.status(404).json({ error: "Ingestion run not found" }); return; }

  const startedAt = runRow.run.startedAt;
  const endedAt = runRow.run.completedAt ?? new Date();

  const paperConds = [
    gte(papersTable.createdAt, startedAt),
    lte(papersTable.createdAt, endedAt),
  ];
  if (runRow.run.topicId != null) paperConds.push(eq(papersTable.topicId, runRow.run.topicId));

  const papersRows = await db
    .select({
      id: papersTable.id,
      title: papersTable.title,
      authors: papersTable.authors,
      journal: papersTable.journal,
      publicationYear: papersTable.publicationYear,
      methodologyType: papersTable.methodologyType,
      evidenceQuality: papersTable.evidenceQuality,
      pmid: papersTable.pmid,
      doi: papersTable.doi,
      createdAt: papersTable.createdAt,
      claimsCount: sql<number>`(select count(*)::int from ${claimsTable} where ${claimsTable.paperId} = ${papersTable.id})`,
    })
    .from(papersTable)
    .where(and(...paperConds))
    .orderBy(desc(papersTable.createdAt));

  const claimConds = [
    gte(claimsTable.createdAt, startedAt),
    lte(claimsTable.createdAt, endedAt),
  ];
  if (runRow.run.topicId != null) claimConds.push(eq(claimsTable.topicId, runRow.run.topicId));

  const claimsRows = await db
    .select({
      id: claimsTable.id,
      paperId: claimsTable.paperId,
      paperTitle: papersTable.title,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      evidenceQuality: claimsTable.evidenceQuality,
      population: claimsTable.population,
      createdAt: claimsTable.createdAt,
    })
    .from(claimsTable)
    .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
    .where(and(...claimConds))
    .orderBy(desc(claimsTable.createdAt));

  res.json({
    run: {
      ...runRow.run,
      topicName: runRow.topicName ?? null,
      startedAt: runRow.run.startedAt.toISOString(),
      completedAt: runRow.run.completedAt?.toISOString() ?? null,
      createdAt: runRow.run.createdAt.toISOString(),
    },
    papers: papersRows.map(p => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
    claims: claimsRows.map(c => ({
      ...c,
      paperTitle: c.paperTitle ?? "(unknown paper)",
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

router.post("/admin/ingestion/run", ingestionRateLimit, async (req, res): Promise<void> => {
  if (!acquireIngestionLock()) {
    res.status(409).json({ error: "Ingestion is already running" });
    return;
  }

  const topicId = req.body?.topicId ? parseInt(req.body.topicId) : undefined;
  const userId = req.currentUser?.id;

  runIngestion("manual", topicId, userId)
    .catch(err => {
      logger.error({ err }, "Manual ingestion run failed");
    })
    .finally(() => {
      releaseIngestionLock();
    });

  res.json({ message: "Ingestion started", topicId: topicId ?? null });
});

// Per Task #11: ingestion search query is capped at 200 chars (tighter than
// the 500-char general request cap because PubMed query strings beyond that
// length are almost always misuse).
const VALID_SOURCES = ["pubmed", "semantic-scholar", "openalex", "biorxiv"] as const;
const SourcesSchema = z.array(z.enum(VALID_SOURCES)).min(1).max(VALID_SOURCES.length);

const CreateConfigBody = z.object({
  topicId: z.number().int().positive(),
  pubmedQuery: z.string().min(3).max(MAX_INGESTION_QUERY_LEN),
  maxPapersPerRun: z.number().int().min(1).max(50).optional().default(10),
  enabled: z.number().int().min(0).max(1).optional().default(1),
  llmModel: z.string().optional().default("gpt-5-mini"),
  sources: SourcesSchema.optional().default(["pubmed"]),
});

const UpdateConfigBody = z.object({
  pubmedQuery: z.string().min(3).max(MAX_INGESTION_QUERY_LEN).optional(),
  maxPapersPerRun: z.number().int().min(1).max(50).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
  llmModel: z.string().optional(),
  sources: SourcesSchema.optional(),
});

router.get("/admin/ingestion-configs", async (_req, res): Promise<void> => {
  const configs = await db
    .select({ config: ingestionConfigsTable, topicName: topicsTable.name })
    .from(ingestionConfigsTable)
    .leftJoin(topicsTable, eq(ingestionConfigsTable.topicId, topicsTable.id))
    .orderBy(ingestionConfigsTable.id);
  res.json(configs.map(c => ({
    ...c.config,
    createdAt: c.config.createdAt.toISOString(),
    updatedAt: c.config.updatedAt.toISOString(),
    topicName: c.topicName ?? null,
  })));
});

router.post("/admin/ingestion-configs", async (req, res): Promise<void> => {
  const body = CreateConfigBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [config] = await db.insert(ingestionConfigsTable).values({ ...body.data, createdByUserId: req.currentUser?.id ?? null, updatedByUserId: req.currentUser?.id ?? null }).returning();
  res.status(201).json({ ...config, createdAt: config.createdAt.toISOString(), updatedAt: config.updatedAt.toISOString() });
});

router.patch("/admin/ingestion-configs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = UpdateConfigBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [updated] = await db.update(ingestionConfigsTable).set({ ...body.data, updatedByUserId: req.currentUser?.id ?? null }).where(eq(ingestionConfigsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Config not found" }); return; }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

router.delete("/admin/ingestion-configs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(ingestionConfigsTable).where(eq(ingestionConfigsTable.id, id));
  res.status(204).end();
});

// Pending claim review queue: surfaces every claim with status='pending'
// (low-confidence extractions or community-flagged items). Editors triage from
// here via POST /admin/claims/:id/review.
router.get("/admin/review-queue", async (req, res): Promise<void> => {
  const limitRaw = parseInt(String(req.query.limit ?? "50"));
  const offsetRaw = parseInt(String(req.query.offset ?? "0"));
  const limit = isNaN(limitRaw) ? 50 : Math.min(Math.max(1, limitRaw), 200);
  const offset = isNaN(offsetRaw) ? 0 : Math.max(0, offsetRaw);

  const where = or(
    eq(claimsTable.status, "pending"),
    sql`${claimsTable.flagCount} > 0`,
  );

  const rows = await db
    .select({
      id: claimsTable.id,
      topicId: claimsTable.topicId,
      topicName: topicsTable.name,
      paperId: claimsTable.paperId,
      paperTitle: papersTable.title,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      evidenceQuality: claimsTable.evidenceQuality,
      confidence: claimsTable.confidence,
      status: claimsTable.status,
      flagCount: claimsTable.flagCount,
      createdAt: claimsTable.createdAt,
    })
    .from(claimsTable)
    .leftJoin(topicsTable, eq(claimsTable.topicId, topicsTable.id))
    .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
    .where(where)
    .orderBy(desc(claimsTable.flagCount), claimsTable.confidence, desc(claimsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(claimsTable)
    .where(where);

  res.json({
    claims: rows.map(r => ({
      ...r,
      topicName: r.topicName ?? null,
      paperTitle: r.paperTitle ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total: totalRow?.count ?? 0,
  });
});

const ReviewBody = z.object({
  decision: z.enum(["approve", "reject", "edit"]),
  notes: z.string().max(500).optional().nullable(),
  edited: z.record(z.string(), z.unknown()).optional().nullable(),
});

const EDITABLE_FIELDS = new Set(["claimText", "direction", "population", "conditions", "effectSize", "effectSizeUnit", "ciLower", "ciUpper", "methodologyType", "evidenceQuality"]);

router.post("/admin/claims/:id/review", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = ReviewBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Claim not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (body.data.decision === "approve") {
    updates.status = "approved";
    // Reviewer override: bump confidence so the auto-approve threshold doesn't
    // immediately re-pull this back into the queue.
    if (existing.confidence < 0.9) updates.confidence = 0.95;
  } else if (body.data.decision === "reject") {
    updates.status = "rejected";
  } else if (body.data.decision === "edit") {
    if (body.data.edited && typeof body.data.edited === "object") {
      for (const [k, v] of Object.entries(body.data.edited)) {
        if (EDITABLE_FIELDS.has(k) && v !== undefined) updates[k] = v;
      }
    }
    // An edit implicitly approves: the human has rewritten it as needed.
    updates.status = "approved";
    if (existing.confidence < 0.9) updates.confidence = 0.95;
  }

  const [updated] = await db.update(claimsTable).set(updates).where(eq(claimsTable.id, id)).returning();
  await db.insert(claimReviewsTable).values({
    claimId: id,
    reviewerId: req.currentUser?.id ?? null,
    decision: body.data.decision,
    notes: body.data.notes ?? null,
  });

  res.json({ id: updated.id, status: updated.status, confidence: updated.confidence });
});

// Touch getAdapter so the import is "used" even before any source-aware admin
// view ships; keeps adapter registry warm during dev.
void getAdapter;

router.post("/admin/embeddings/backfill", async (req, res): Promise<void> => {
  if (!isEmbeddingsAvailable()) {
    res.status(503).json({ error: "OPENAI_API_KEY not configured; embeddings disabled" });
    return;
  }
  const limitRaw = parseInt(String(req.query.limit ?? req.body?.limit ?? "200"));
  const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 1000));
  const result = await backfillClaimEmbeddings(limit);
  logger.info({ result }, "Claim embedding backfill completed");
  res.json(result);
});

export default router;
