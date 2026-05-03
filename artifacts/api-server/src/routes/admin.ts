import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, ingestionRunsTable, ingestionConfigsTable, topicsTable } from "@workspace/db";
import { runIngestion } from "../lib/ingestionWorker";
import { acquireIngestionLock, releaseIngestionLock } from "../lib/ingestionScheduler";
import { logger } from "../lib/logger";
import { z } from "zod";

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

router.post("/admin/ingestion/run", async (req, res): Promise<void> => {
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

const CreateConfigBody = z.object({
  topicId: z.number().int().positive(),
  pubmedQuery: z.string().min(3).max(500),
  maxPapersPerRun: z.number().int().min(1).max(50).optional().default(10),
  enabled: z.number().int().min(0).max(1).optional().default(1),
  llmModel: z.string().optional().default("gpt-5-mini"),
});

const UpdateConfigBody = z.object({
  pubmedQuery: z.string().min(3).max(500).optional(),
  maxPapersPerRun: z.number().int().min(1).max(50).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
  llmModel: z.string().optional(),
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

export default router;
