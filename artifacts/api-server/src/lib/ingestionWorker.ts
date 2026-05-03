import { db, topicsTable, papersTable, claimsTable, ingestionRunsTable, ingestionConfigsTable } from "@workspace/db";
import { eq, inArray, and } from "drizzle-orm";
import { searchPubMed, fetchPubMedPapers } from "./pubmed";
import { extractClaims } from "./claimExtractor";
import { linkEvidence, refreshClaimSynthesis } from "./evidenceLinker";
import { embedAndStoreClaim } from "./embeddings";
import { logger } from "./logger";

async function getBatchProcess() {
  const { batchProcess } = await import("@workspace/integrations-openai-ai-server/batch");
  return batchProcess;
}

export interface IngestionResult {
  runId: number;
  topicId: number | null;
  papersFound: number;
  papersProcessed: number;
  claimsExtracted: number;
  errorsCount: number;
  errors: string[];
}

export async function runIngestion(triggeredBy: "scheduler" | "manual" = "scheduler", topicIdFilter?: number, createdByUserId?: string): Promise<IngestionResult[]> {
  const configs = await db.select({
    config: ingestionConfigsTable,
    topic: topicsTable,
  })
    .from(ingestionConfigsTable)
    .innerJoin(topicsTable, eq(ingestionConfigsTable.topicId, topicsTable.id))
    .where(topicIdFilter != null
      ? eq(ingestionConfigsTable.topicId, topicIdFilter)
      : eq(ingestionConfigsTable.enabled, 1));

  if (configs.length === 0) {
    logger.info("No enabled ingestion configs found; skipping run");
    return [];
  }

  const results: IngestionResult[] = [];

  for (const { config, topic } of configs) {
    const [run] = await db.insert(ingestionRunsTable).values({
      topicId: config.topicId,
      status: "running",
      triggeredBy,
      startedAt: new Date(),
      createdByUserId: createdByUserId ?? null,
    }).returning();

    const result: IngestionResult = {
      runId: run.id,
      topicId: config.topicId,
      papersFound: 0,
      papersProcessed: 0,
      claimsExtracted: 0,
      errorsCount: 0,
      errors: [],
    };

    try {
      logger.info({ topicId: config.topicId, query: config.pubmedQuery }, "Starting ingestion for topic");

      const pmids = await searchPubMed(config.pubmedQuery, config.maxPapersPerRun);
      result.papersFound = pmids.length;

      if (pmids.length === 0) {
        await db.update(ingestionRunsTable).set({
          status: "completed",
          papersFound: 0,
          completedAt: new Date(),
        }).where(eq(ingestionRunsTable.id, run.id));
        results.push(result);
        continue;
      }

      const existingPmids = await db.select({ pmid: papersTable.pmid }).from(papersTable).where(inArray(papersTable.pmid, pmids));
      const existingPmidSet = new Set(existingPmids.map(r => r.pmid).filter(Boolean));
      const newPmids = pmids.filter(p => !existingPmidSet.has(p));

      if (newPmids.length === 0) {
        logger.info({ topicId: config.topicId }, "All papers already ingested; skipping");
        await db.update(ingestionRunsTable).set({
          status: "completed",
          papersFound: pmids.length,
          completedAt: new Date(),
        }).where(eq(ingestionRunsTable.id, run.id));
        results.push(result);
        continue;
      }

      await new Promise(r => setTimeout(r, 500));
      const papers = await fetchPubMedPapers(newPmids);

      const batchProcess = await getBatchProcess();
      await batchProcess(
        papers,
        async (paper) => {
          try {
            const methodologyType = inferMethodology(paper.abstract);
            const evidenceQuality = inferEvidenceQuality(methodologyType);

            const [insertedPaper] = await db.insert(papersTable).values({
              topicId: config.topicId,
              title: paper.title,
              authors: paper.authors,
              journal: paper.journal,
              publicationYear: paper.publicationYear,
              doi: paper.doi,
              pmid: paper.pmid,
              abstract: paper.abstract,
              methodologyType,
              sampleSize: paper.sampleSize ?? null,
              pValue: paper.pValue ?? null,
              evidenceQuality,
              replicationStatus: "unverified",
              openAccessUrl: paper.openAccessUrl,
              rawAbstractXml: paper.rawAbstractXml,
            }).returning();

            const claims = await extractClaims(
              { abstract: paper.abstract, methodsText: paper.methodsText ?? null },
              config.llmModel
            );

            for (const claim of claims) {
              const normalizedText = claim.claimText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
              const existing = await db.select({ id: claimsTable.id, claimText: claimsTable.claimText })
                .from(claimsTable)
                .where(and(
                  eq(claimsTable.paperId, insertedPaper.id),
                  eq(claimsTable.direction, claim.direction),
                  eq(claimsTable.population, claim.population),
                ))
                .limit(10);
              const isDuplicate = existing.some(e =>
                e.claimText.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120) === normalizedText
              );

              if (isDuplicate) {
                logger.debug({ claimText: claim.claimText, paperId: insertedPaper.id }, "Skipping duplicate claim");
                continue;
              }

              const [insertedClaim] = await db.insert(claimsTable).values({
                topicId: config.topicId,
                paperId: insertedPaper.id,
                claimText: claim.claimText,
                direction: claim.direction,
                effectSize: claim.effectSize,
                effectSizeUnit: claim.effectSizeUnit,
                ciLower: claim.ciLower,
                ciUpper: claim.ciUpper,
                population: claim.population,
                conditions: claim.conditions,
                methodologyType: claim.methodologyType,
                evidenceQuality: claim.evidenceQuality,
                replicationStatus: "unverified",
                nReplications: 0,
              }).returning();

              // Fire-and-forget: embedding generation is best-effort and
              // logs its own failures. Awaiting would serialize ingestion
              // behind OpenAI latency.
              void embedAndStoreClaim(insertedClaim.id, claim.claimText);
              await linkEvidence(insertedClaim.id, claim, config.topicId, insertedPaper.id);
              await refreshClaimSynthesis(insertedClaim.id, config.topicId);
              result.claimsExtracted++;
            }

            result.papersProcessed++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ err, pmid: paper.pmid }, "Failed to process paper");
            result.errorsCount++;
            result.errors.push(`PMID ${paper.pmid}: ${msg}`);
          }
        },
        { concurrency: 1, retries: 2 }
      );

      await db.update(ingestionRunsTable).set({
        status: "completed",
        papersFound: result.papersFound,
        papersProcessed: result.papersProcessed,
        claimsExtracted: result.claimsExtracted,
        errorsCount: result.errorsCount,
        errorDetails: result.errors.length > 0 ? result.errors.slice(0, 10).join("\n") : null,
        completedAt: new Date(),
      }).where(eq(ingestionRunsTable.id, run.id));

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, topicId: config.topicId }, "Ingestion run failed");
      result.errorsCount++;
      result.errors.push(msg);
      await db.update(ingestionRunsTable).set({
        status: "failed",
        errorsCount: result.errorsCount,
        errorDetails: result.errors.slice(0, 10).join("\n"),
        completedAt: new Date(),
      }).where(eq(ingestionRunsTable.id, run.id));
    }

    results.push(result);
  }

  return results;
}

function inferMethodology(abstract: string): string {
  const lower = abstract.toLowerCase();
  if (/meta.?analy|systematic review/.test(lower)) return "meta-analysis";
  if (/random(ised|ized)|rct|double.blind|placebo.control/.test(lower)) return "rct";
  if (/cohort|prospective|follow.?up/.test(lower)) return "cohort";
  if (/case.control/.test(lower)) return "case-control";
  if (/cross.?section/.test(lower)) return "cross-sectional";
  if (/review/.test(lower)) return "review";
  return "observational";
}

function inferEvidenceQuality(methodology: string): string {
  if (["meta-analysis"].includes(methodology)) return "A";
  if (["rct", "cohort"].includes(methodology)) return "B";
  if (["case-control", "cross-sectional", "observational"].includes(methodology)) return "C";
  return "C";
}
