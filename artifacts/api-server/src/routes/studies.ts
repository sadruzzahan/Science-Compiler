import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, studiesTable } from "@workspace/db";
import { GetStudyParams, GetStudyResponse, CreateStudyBody, UpdateStudyBody } from "@workspace/api-zod";
import { requireUser } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/studies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = GetStudyParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [study] = await db.select().from(studiesTable).where(eq(studiesTable.id, id));
  if (!study) {
    res.status(404).json({ error: "Study not found" });
    return;
  }

  res.json(GetStudyResponse.parse({
    ...study,
    createdAt: study.createdAt.toISOString(),
    updatedAt: study.updatedAt.toISOString(),
  }));
});

type StudyInsert = typeof studiesTable.$inferInsert;
function stripStudy(d: Record<string, unknown>): Partial<StudyInsert> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null && v !== undefined) out[k] = v;
  return out as Partial<StudyInsert>;
}

router.post("/studies", requireUser, async (req, res): Promise<void> => {
  const body = CreateStudyBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [study] = await db.insert(studiesTable).values(stripStudy(body.data) as StudyInsert).returning();
  res.status(201).json({ ...study, createdAt: study!.createdAt.toISOString(), updatedAt: study!.updatedAt.toISOString() });
});

router.patch("/studies/:id", requireUser, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = UpdateStudyBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [study] = await db.update(studiesTable).set(stripStudy(body.data)).where(eq(studiesTable.id, id)).returning();
  if (!study) { res.status(404).json({ error: "Study not found" }); return; }
  res.json({ ...study, createdAt: study.createdAt.toISOString(), updatedAt: study.updatedAt.toISOString() });
});

router.delete("/studies/:id", requireUser, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const result = await db.delete(studiesTable).where(eq(studiesTable.id, id)).returning({ id: studiesTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Study not found" }); return; }
  res.status(204).send();
});

export default router;
