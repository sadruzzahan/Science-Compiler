import { Router, type IRouter } from "express";
import { eq, sql, and, ilike, type SQL } from "drizzle-orm";
import { db, papersTable, topicsTable, claimsTable, claimSynthesisTable } from "@workspace/db";
import {
  ListPapersQueryParams,
  ListPapersResponse,
  GetPaperParams,
  GetPaperResponse,
  CreatePaperBody,
  UpdatePaperBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/papers", async (req, res): Promise<void> => {
  const query = ListPapersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { topicId, methodologyType, evidenceQuality, replicationStatus, search, limit = 20, offset = 0 } = query.data;

  const conditions: SQL[] = [];
  if (topicId != null) conditions.push(eq(papersTable.topicId, topicId));
  if (methodologyType) conditions.push(eq(papersTable.methodologyType, methodologyType));
  if (evidenceQuality) conditions.push(eq(papersTable.evidenceQuality, evidenceQuality));
  if (replicationStatus) conditions.push(eq(papersTable.replicationStatus, replicationStatus));
  if (search) conditions.push(ilike(papersTable.title, `%${search}%`));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const papers = await db
    .select()
    .from(papersTable)
    .where(whereClause)
    .orderBy(sql`${papersTable.publicationYear} DESC`)
    .limit(limit ?? 20)
    .offset(offset ?? 0);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(papersTable)
    .where(whereClause);

  const papersOut = papers.map(p => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  res.json(ListPapersResponse.parse({ papers: papersOut, total: totalRow?.count ?? 0, limit: limit ?? 20, offset: offset ?? 0 }));
});

router.get("/papers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = GetPaperParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, id));
  if (!paper) {
    res.status(404).json({ error: "Paper not found" });
    return;
  }

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, paper.topicId));

  const claimsRaw = await db
    .select({
      id: claimsTable.id,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      evidenceQuality: claimsTable.evidenceQuality,
      consensusStatus: claimSynthesisTable.consensusStatus,
      supportingCount: claimSynthesisTable.supportingCount,
      contradictingCount: claimSynthesisTable.contradictingCount,
    })
    .from(claimsTable)
    .leftJoin(claimSynthesisTable, eq(claimsTable.id, claimSynthesisTable.claimId))
    .where(eq(claimsTable.paperId, id));

  const claims = claimsRaw.map(c => ({
    ...c,
    topicName: topic?.name ?? null,
  }));

  const result = {
    ...paper,
    topicName: topic?.name ?? "Unknown",
    createdAt: paper.createdAt.toISOString(),
    updatedAt: paper.updatedAt.toISOString(),
    claims,
  };

  res.json(GetPaperResponse.parse(result));
});

type PaperInsert = typeof papersTable.$inferInsert;
function stripPaper(d: Record<string, unknown>): Partial<PaperInsert> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null && v !== undefined) out[k] = v;
  return out as Partial<PaperInsert>;
}

router.post("/papers", async (req, res): Promise<void> => {
  const body = CreatePaperBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [paper] = await db.insert(papersTable).values(stripPaper(body.data) as PaperInsert).returning();
  res.status(201).json({ ...paper, createdAt: paper!.createdAt.toISOString(), updatedAt: paper!.updatedAt.toISOString() });
});

router.patch("/papers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = UpdatePaperBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [paper] = await db.update(papersTable).set(stripPaper(body.data)).where(eq(papersTable.id, id)).returning();
  if (!paper) { res.status(404).json({ error: "Paper not found" }); return; }
  res.json({ ...paper, createdAt: paper.createdAt.toISOString(), updatedAt: paper.updatedAt.toISOString() });
});

router.delete("/papers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const result = await db.delete(papersTable).where(eq(papersTable.id, id)).returning({ id: papersTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Paper not found" }); return; }
  res.status(204).send();
});

export default router;
