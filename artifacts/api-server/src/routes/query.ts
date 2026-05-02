import { Router, type IRouter } from "express";
import { eq, sql, ilike, or } from "drizzle-orm";
import { db, claimsTable, topicsTable, papersTable, claimSynthesisTable, evidenceLinksTable, studiesTable } from "@workspace/db";
import { QueryKnowledgeBaseQueryParams, QueryKnowledgeBaseResponse, GetRecentActivityResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/query/recent", async (_req, res): Promise<void> => {
  const recentClaimsRaw = await db
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
    .orderBy(sql`${claimsTable.createdAt} DESC`)
    .limit(8);

  const recentClaims = recentClaimsRaw.map(c => ({
    ...c,
    topicName: c.topicName ?? "Unknown",
    createdAt: c.createdAt.toISOString(),
  }));

  const recentPapersRaw = await db
    .select({
      id: papersTable.id,
      title: papersTable.title,
      authors: papersTable.authors,
      journal: papersTable.journal,
      publicationYear: papersTable.publicationYear,
      methodologyType: papersTable.methodologyType,
      evidenceQuality: papersTable.evidenceQuality,
      replicationStatus: papersTable.replicationStatus,
      topicName: topicsTable.name,
    })
    .from(papersTable)
    .leftJoin(topicsTable, eq(papersTable.topicId, topicsTable.id))
    .orderBy(sql`${papersTable.createdAt} DESC`)
    .limit(5);

  const recentPapers = recentPapersRaw.map(p => ({
    ...p,
    topicName: p.topicName ?? "Unknown",
  }));

  const [topicCount] = await db.select({ count: sql<number>`count(*)::int` }).from(topicsTable);
  const [claimCount] = await db.select({ count: sql<number>`count(*)::int` }).from(claimsTable);
  const [paperCount] = await db.select({ count: sql<number>`count(*)::int` }).from(papersTable);
  const [studyCount] = await db.select({ count: sql<number>`count(*)::int` }).from(studiesTable);

  const synthesisCounts = await db
    .select({
      consensusStatus: claimSynthesisTable.consensusStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(claimSynthesisTable)
    .groupBy(claimSynthesisTable.consensusStatus);

  const statusMap: Record<string, number> = {};
  for (const row of synthesisCounts) {
    statusMap[row.consensusStatus] = row.count;
  }

  const stats = {
    totalTopics: topicCount?.count ?? 0,
    totalClaims: claimCount?.count ?? 0,
    totalPapers: paperCount?.count ?? 0,
    totalStudies: studyCount?.count ?? 0,
    wellEstablishedCount: statusMap["well-established"] ?? 0,
    contestedCount: statusMap["contested"] ?? 0,
    preliminaryCount: statusMap["preliminary"] ?? 0,
    recentPapers,
  };

  res.json(GetRecentActivityResponse.parse({ recentClaims, recentPapers, stats }));
});

router.get("/query", async (req, res): Promise<void> => {
  const queryParams = QueryKnowledgeBaseQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const { q } = queryParams.data;
  const searchTerms = q.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  if (searchTerms.length === 0) {
    res.json(QueryKnowledgeBaseResponse.parse({ query: q, noResults: true }));
    return;
  }

  // Build OR conditions for any term matching any field
  const termConditions = searchTerms.flatMap(term => {
    const pat = `%${term}%`;
    return [
      ilike(claimsTable.claimText, pat),
      ilike(claimsTable.population, pat),
      ilike(claimsTable.conditions, pat),
      ilike(topicsTable.name, pat),
      ilike(papersTable.title, pat),
    ];
  });

  const candidates = await db
    .select({
      id: claimsTable.id,
      topicId: claimsTable.topicId,
      topicName: topicsTable.name,
      paperId: claimsTable.paperId,
      paperTitle: papersTable.title,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      effectSize: claimsTable.effectSize,
      effectSizeUnit: claimsTable.effectSizeUnit,
      ciLower: claimsTable.ciLower,
      ciUpper: claimsTable.ciUpper,
      population: claimsTable.population,
      conditions: claimsTable.conditions,
      methodologyType: claimsTable.methodologyType,
      evidenceQuality: claimsTable.evidenceQuality,
      replicationStatus: claimsTable.replicationStatus,
      nReplications: claimsTable.nReplications,
      createdAt: claimsTable.createdAt,
      updatedAt: claimsTable.updatedAt,
    })
    .from(claimsTable)
    .leftJoin(topicsTable, eq(claimsTable.topicId, topicsTable.id))
    .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
    .where(or(...termConditions))
    .limit(50);

  if (candidates.length === 0) {
    res.json(QueryKnowledgeBaseResponse.parse({ query: q, noResults: true }));
    return;
  }

  // Tokenized relevance scoring: weight matches in claimText > topic > population/conditions > paperTitle
  function scoreClaim(c: typeof candidates[number]): number {
    const claim = c.claimText.toLowerCase();
    const topic = (c.topicName ?? "").toLowerCase();
    const paper = (c.paperTitle ?? "").toLowerCase();
    const pop = (c.population ?? "").toLowerCase();
    const cond = (c.conditions ?? "").toLowerCase();
    let score = 0;
    for (const term of searchTerms) {
      if (claim.includes(term)) score += 5;
      if (topic.includes(term)) score += 3;
      if (pop.includes(term)) score += 2;
      if (cond.includes(term)) score += 2;
      if (paper.includes(term)) score += 1;
    }
    // Bonus for higher quality evidence
    if (c.evidenceQuality === "A") score += 1;
    return score;
  }

  // Sort by score desc, then deterministic by id asc
  const ranked = [...candidates].sort((a, b) => {
    const sd = scoreClaim(b) - scoreClaim(a);
    if (sd !== 0) return sd;
    return a.id - b.id;
  });

  const bestMatch = ranked[0];
  const claimId = bestMatch.id;

  const [synthesis] = await db
    .select()
    .from(claimSynthesisTable)
    .where(eq(claimSynthesisTable.claimId, claimId));

  const evidenceLinks = await db
    .select()
    .from(evidenceLinksTable)
    .leftJoin(studiesTable, eq(evidenceLinksTable.studyId, studiesTable.id))
    .where(eq(evidenceLinksTable.claimId, claimId));

  const supportingStudies = evidenceLinks
    .filter(e => e.evidence_links.direction === "supporting" && e.studies)
    .map(e => ({
      id: e.evidence_links.id,
      claimId: e.evidence_links.claimId,
      studyId: e.evidence_links.studyId,
      direction: e.evidence_links.direction,
      contradictionExplanation: e.evidence_links.contradictionExplanation,
      study: {
        ...e.studies!,
        createdAt: e.studies!.createdAt.toISOString(),
        updatedAt: e.studies!.updatedAt.toISOString(),
      },
    }));

  const contradictingStudies = evidenceLinks
    .filter(e => e.evidence_links.direction === "contradicting" && e.studies)
    .map(e => ({
      id: e.evidence_links.id,
      claimId: e.evidence_links.claimId,
      studyId: e.evidence_links.studyId,
      direction: e.evidence_links.direction,
      contradictionExplanation: e.evidence_links.contradictionExplanation,
      study: {
        ...e.studies!,
        createdAt: e.studies!.createdAt.toISOString(),
        updatedAt: e.studies!.updatedAt.toISOString(),
      },
    }));

  const matchedClaim = {
    ...bestMatch,
    topicName: bestMatch.topicName ?? "Unknown",
    paperTitle: bestMatch.paperTitle ?? "Unknown",
    createdAt: bestMatch.createdAt.toISOString(),
    updatedAt: bestMatch.updatedAt.toISOString(),
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

  // Related claims (same topic, excluding the best match)
  const relatedClaimsRaw = await db
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
    .where(eq(claimsTable.topicId, bestMatch.topicId))
    .limit(5);

  const relatedClaims = relatedClaimsRaw
    .filter(c => c.id !== claimId)
    .map(c => ({
      ...c,
      topicName: bestMatch.topicName ?? "Unknown",
    }));

  res.json(QueryKnowledgeBaseResponse.parse({ query: q, matchedClaim, relatedClaims, noResults: false }));
});

export default router;
