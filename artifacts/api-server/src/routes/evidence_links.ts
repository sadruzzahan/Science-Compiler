import { Router, type IRouter } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import { db, evidenceLinksTable } from "@workspace/db";
import { CreateEvidenceLinkBody, UpdateEvidenceLinkBody, ListEvidenceLinksQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/evidence-links", async (req, res): Promise<void> => {
  const query = ListEvidenceLinksQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { claimId, studyId, direction, limit = 50, offset = 0 } = query.data;
  const conditions: SQL[] = [];
  if (claimId != null) conditions.push(eq(evidenceLinksTable.claimId, claimId));
  if (studyId != null) conditions.push(eq(evidenceLinksTable.studyId, studyId));
  if (direction) conditions.push(eq(evidenceLinksTable.direction, direction));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const links = await db.select().from(evidenceLinksTable).where(whereClause).limit(limit ?? 50).offset(offset ?? 0);
  res.json(links.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

type EvidenceLinkInsert = typeof evidenceLinksTable.$inferInsert;
function stripLink(d: Record<string, unknown>): Partial<EvidenceLinkInsert> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null && v !== undefined) out[k] = v;
  return out as Partial<EvidenceLinkInsert>;
}

router.post("/evidence-links", async (req, res): Promise<void> => {
  const body = CreateEvidenceLinkBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [link] = await db.insert(evidenceLinksTable).values(stripLink(body.data) as EvidenceLinkInsert).returning();
  res.status(201).json({ ...link, createdAt: link!.createdAt.toISOString() });
});

router.patch("/evidence-links/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = UpdateEvidenceLinkBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [link] = await db.update(evidenceLinksTable).set(stripLink(body.data)).where(eq(evidenceLinksTable.id, id)).returning();
  if (!link) { res.status(404).json({ error: "Evidence link not found" }); return; }
  res.json({ ...link, createdAt: link.createdAt.toISOString() });
});

router.delete("/evidence-links/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const result = await db.delete(evidenceLinksTable).where(eq(evidenceLinksTable.id, id)).returning({ id: evidenceLinksTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Evidence link not found" }); return; }
  res.status(204).send();
});

export default router;
