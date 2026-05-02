import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, topicsTable, papersTable, claimsTable, claimSynthesisTable, studiesTable } from "@workspace/db";
import {
  GetTopicParams,
  GetTopicResponse,
  GetTopicsStatsResponse,
  ListTopicsResponse,
  GetPaperResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/topics/stats", async (_req, res): Promise<void> => {
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

  res.json(GetTopicsStatsResponse.parse(stats));
});

router.get("/topics", async (_req, res): Promise<void> => {
  const topics = await db.select().from(topicsTable).orderBy(topicsTable.name);

  const result = await Promise.all(
    topics.map(async (topic) => {
      const [claimCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(claimsTable)
        .where(eq(claimsTable.topicId, topic.id));

      const [paperCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(papersTable)
        .where(eq(papersTable.topicId, topic.id));

      const synthesisCounts = await db
        .select({
          consensusStatus: claimSynthesisTable.consensusStatus,
          count: sql<number>`count(*)::int`,
        })
        .from(claimSynthesisTable)
        .where(eq(claimSynthesisTable.topicId, topic.id))
        .groupBy(claimSynthesisTable.consensusStatus);

      const statusMap: Record<string, number> = {};
      for (const row of synthesisCounts) {
        statusMap[row.consensusStatus] = row.count;
      }

      return {
        ...topic,
        createdAt: topic.createdAt.toISOString(),
        claimCount: claimCount?.count ?? 0,
        paperCount: paperCount?.count ?? 0,
        wellEstablishedCount: statusMap["well-established"] ?? 0,
        contestedCount: statusMap["contested"] ?? 0,
      };
    })
  );

  res.json(ListTopicsResponse.parse(result));
});

router.get("/topics/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, id));
  if (!topic) {
    res.status(404).json({ error: "Topic not found" });
    return;
  }

  const [claimCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(claimsTable)
    .where(eq(claimsTable.topicId, id));

  const [paperCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(papersTable)
    .where(eq(papersTable.topicId, id));

  const synthesisCounts = await db
    .select({
      consensusStatus: claimSynthesisTable.consensusStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(claimSynthesisTable)
    .where(eq(claimSynthesisTable.topicId, id))
    .groupBy(claimSynthesisTable.consensusStatus);

  const statusMap: Record<string, number> = {};
  for (const row of synthesisCounts) {
    statusMap[row.consensusStatus] = row.count;
  }

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
    .where(eq(claimsTable.topicId, id))
    .orderBy(claimsTable.id)
    .limit(20);

  const claims = claimsRaw.map(c => ({
    ...c,
    topicName: topic.name,
  }));

  const result = {
    ...topic,
    createdAt: topic.createdAt.toISOString(),
    claimCount: claimCountRow?.count ?? 0,
    paperCount: paperCountRow?.count ?? 0,
    wellEstablishedCount: statusMap["well-established"] ?? 0,
    contestedCount: statusMap["contested"] ?? 0,
    preliminaryCount: statusMap["preliminary"] ?? 0,
    claims,
  };

  res.json(GetTopicResponse.parse(result));
});

export default router;
