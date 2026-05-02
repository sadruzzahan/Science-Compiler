import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, evidenceLinksTable } from "@workspace/db";
import { CreateEvidenceLinkBody, UpdateEvidenceLinkBody } from "@workspace/api-zod";

const router: IRouter = Router();

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
