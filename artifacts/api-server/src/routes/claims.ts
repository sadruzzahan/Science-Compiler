import { Router, type IRouter } from "express";
import { eq, sql, and, ilike, type SQL } from "drizzle-orm";
import { db, claimsTable, topicsTable, papersTable, claimSynthesisTable, evidenceLinksTable, studiesTable } from "@workspace/db";
import {
  ListClaimsQueryParams,
  ListClaimsResponse,
  GetClaimParams,
  GetClaimResponse,
  CreateClaimBody,
  UpdateClaimBody,
  GetClaimSynthesisResponse,
} from "@workspace/api-zod";
import { requireUser } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/claims", async (req, res): Promise<void> => {
  const query = ListClaimsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { topicId, consensusStatus, evidenceQuality, direction, search, limit = 20, offset = 0 } = query.data;

  const conditions: SQL[] = [];
  if (topicId != null) conditions.push(eq(claimsTable.topicId, topicId));
  if (evidenceQuality) conditions.push(eq(claimsTable.evidenceQuality, evidenceQuality));
  if (direction) conditions.push(eq(claimsTable.direction, direction));
  if (search) conditions.push(ilike(claimsTable.claimText, `%${search}%`));
  if (consensusStatus) conditions.push(eq(claimSynthesisTable.consensusStatus, consensusStatus));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const claimsRaw = await db
    .select({
      id: claimsTable.id,
      topicId: claimsTable.topicId,
      topicName: topicsTable.name,
      paperId: claimsTable.paperId,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      effectSize: claimsTable.effectSize,
      effectSizeUnit: claimsTable.effectSizeUnit,
      population: claimsTable.population,
      methodologyType: claimsTable.methodologyType,
      evidenceQuality: claimsTable.evidenceQuality,
      replicationStatus: claimsTable.replicationStatus,
      nReplications: claimsTable.nReplications,
      consensusStatus: claimSynthesisTable.consensusStatus,
      supportingCount: claimSynthesisTable.supportingCount,
      contradictingCount: claimSynthesisTable.contradictingCount,
      uncertaintyScore: claimSynthesisTable.uncertaintyScore,
      createdAt: claimsTable.createdAt,
    })
    .from(claimsTable)
    .leftJoin(topicsTable, eq(claimsTable.topicId, topicsTable.id))
    .leftJoin(claimSynthesisTable, eq(claimsTable.id, claimSynthesisTable.claimId))
    .where(whereClause)
    .orderBy(sql`${claimsTable.createdAt} DESC`)
    .limit(limit ?? 20)
    .offset(offset ?? 0);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(claimsTable)
    .leftJoin(claimSynthesisTable, eq(claimsTable.id, claimSynthesisTable.claimId))
    .where(whereClause);

  const claims = claimsRaw.map(c => ({
    ...c,
    topicName: c.topicName ?? "Unknown",
    createdAt: c.createdAt.toISOString(),
  }));

  res.json(ListClaimsResponse.parse({ claims, total: totalRow?.count ?? 0, limit: limit ?? 20, offset: offset ?? 0 }));
});

router.get("/claims/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = GetClaimParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  if (!claim) {
    res.status(404).json({ error: "Claim not found" });
    return;
  }

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, claim.topicId));
  const [paper] = await db.select().from(papersTable).where(eq(papersTable.id, claim.paperId));
  const [synthesis] = await db.select().from(claimSynthesisTable).where(eq(claimSynthesisTable.claimId, id));

  const evidenceLinks = await db
    .select()
    .from(evidenceLinksTable)
    .leftJoin(studiesTable, eq(evidenceLinksTable.studyId, studiesTable.id))
    .where(eq(evidenceLinksTable.claimId, id));

  const supportingStudies = evidenceLinks
    .filter(e => e.evidence_links.direction === "supporting")
    .map(e => ({
      id: e.evidence_links.id,
      claimId: e.evidence_links.claimId,
      studyId: e.evidence_links.studyId,
      direction: e.evidence_links.direction,
      contradictionExplanation: e.evidence_links.contradictionExplanation,
      study: e.studies
        ? {
            ...e.studies,
            createdAt: e.studies.createdAt.toISOString(),
            updatedAt: e.studies.updatedAt.toISOString(),
          }
        : null,
    }))
    .filter(e => e.study !== null);

  const contradictingStudies = evidenceLinks
    .filter(e => e.evidence_links.direction === "contradicting")
    .map(e => ({
      id: e.evidence_links.id,
      claimId: e.evidence_links.claimId,
      studyId: e.evidence_links.studyId,
      direction: e.evidence_links.direction,
      contradictionExplanation: e.evidence_links.contradictionExplanation,
      study: e.studies
        ? {
            ...e.studies,
            createdAt: e.studies.createdAt.toISOString(),
            updatedAt: e.studies.updatedAt.toISOString(),
          }
        : null,
    }))
    .filter(e => e.study !== null);

  const result = {
    ...claim,
    topicName: topic?.name ?? "Unknown",
    paperTitle: paper?.title ?? "Unknown",
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    synthesis: synthesis
      ? {
          ...synthesis,
          lastUpdated: synthesis.lastUpdated.toISOString(),
          createdAt: synthesis.createdAt.toISOString(),
        }
      : undefined,
    supportingStudies,
    contradictingStudies,
  };

  res.json(GetClaimResponse.parse(result));
});

router.get("/claims/:id/synthesis", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [synthesis] = await db.select().from(claimSynthesisTable).where(eq(claimSynthesisTable.claimId, id));
  if (!synthesis) { res.status(404).json({ error: "Synthesis not found" }); return; }
  res.json(GetClaimSynthesisResponse.parse({
    ...synthesis,
    lastUpdated: synthesis.lastUpdated.toISOString(),
    createdAt: synthesis.createdAt.toISOString(),
  }));
});

type ClaimInsert = typeof claimsTable.$inferInsert;
function stripClaim(d: Record<string, unknown>): Partial<ClaimInsert> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== null && v !== undefined) out[k] = v;
  return out as Partial<ClaimInsert>;
}

router.post("/claims", requireUser, async (req, res): Promise<void> => {
  const body = CreateClaimBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [claim] = await db.insert(claimsTable).values(stripClaim(body.data) as ClaimInsert).returning();
  res.status(201).json({ ...claim, createdAt: claim!.createdAt.toISOString(), updatedAt: claim!.updatedAt.toISOString() });
});

router.patch("/claims/:id", requireUser, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = UpdateClaimBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [claim] = await db.update(claimsTable).set(stripClaim(body.data)).where(eq(claimsTable.id, id)).returning();
  if (!claim) { res.status(404).json({ error: "Claim not found" }); return; }
  res.json({ ...claim, createdAt: claim.createdAt.toISOString(), updatedAt: claim.updatedAt.toISOString() });
});

router.delete("/claims/:id", requireUser, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const result = await db.delete(claimsTable).where(eq(claimsTable.id, id)).returning({ id: claimsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Claim not found" }); return; }
  res.status(204).send();
});

export default router;
