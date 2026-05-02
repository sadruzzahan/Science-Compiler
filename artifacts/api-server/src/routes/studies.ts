import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, studiesTable } from "@workspace/db";
import { GetStudyParams, GetStudyResponse } from "@workspace/api-zod";

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

export default router;
