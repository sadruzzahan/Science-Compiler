import { db, topicsTable, papersTable, claimsTable, ingestionRunsTable, ingestionConfigsTable, paperSourcesTable } from "@workspace/db";
import { eq, inArray, and, or, isNotNull } from "drizzle-orm";
import { extractClaims } from "./claimExtractor";
import { linkEvidence, refreshClaimSynthesis } from "./evidenceLinker";
import { embedAndStoreClaim } from "./embeddings";
import { logger } from "./logger";
import { getAdapters, fingerprint, type NormalizedPaper, type SourceAdapter } from "./sources";
import { resolveFullText, type FullTextStatus } from "./fullTextExtractor";

async function getBatchProcess() {
  const { batchProcess } = await import("@workspace/integrations-openai-ai-server/batch");
  return batchProcess;
}

const PENDING_CLAIM_THRESHOLD = parseFloat(process.env.CLAIM_PENDING_THRESHOLD ?? "0.7");

export interface IngestionResult {
  runId: number;
  topicId: number | null;
  papersFound: number;
  papersProcessed: number;
  papersDeduplicated: number;
  fullTextFetched: number;
  lowConfidenceClaims: number;
  claimsExtracted: number;
  errorsCount: number;
  errors: string[];
  perSourceCounts: Record<string, number>;
}

interface CandidatePaper extends NormalizedPaper {
  sources: Array<{ adapter: SourceAdapter; nativeId: string; url: string | null }>;
  fingerprint: string;
}

/**
 * Fan a query out across the configured source adapters. Each adapter
 * surfaces native ids; we dedup across them by DOI first, then by a
 * lowercase title|year|firstAuthor fingerprint. Every contributing source is
 * later recorded in `paper_sources` so a paper is visibly attributed to
 * each provider that returned it.
 */
async function gatherCandidates(query: string, adapters: SourceAdapter[], maxPerSource: number): Promise<{
  candidates: CandidatePaper[];
  perSourceFound: Record<string, number>;
}> {
  const perSourceFound: Record<string, number> = {};
  const fetched: Array<{ adapter: SourceAdapter; paper: NormalizedPaper }> = [];

  await Promise.all(adapters.map(async (adapter) => {
    try {
      const ids = await adapter.search(query, { limit: maxPerSource });
      perSourceFound[adapter.id] = ids.length;
      if (ids.length === 0) return;
      const papers = await adapter.fetchByIds(ids.slice(0, maxPerSource));
      for (const p of papers) fetched.push({ adapter, paper: p });
    } catch (err) {
      logger.warn({ err, adapter: adapter.id, query }, "Source adapter failed");
      perSourceFound[adapter.id] = 0;
    }
  }));

  // Merge by DOI → fingerprint. The first-seen adapter "owns" the canonical
  // record (mostly to keep the abstract/methods text stable); later ones are
  // appended as additional sources.
  const byKey = new Map<string, CandidatePaper>();
  for (const { adapter, paper } of fetched) {
    const fp = fingerprint(paper.title, paper.publicationYear, paper.firstAuthor);
    const doiKey = paper.doi ? `doi:${paper.doi.toLowerCase()}` : null;
    const fpKey = `fp:${fp}`;
    const existingByDoi = doiKey ? byKey.get(doiKey) : null;
    const existingByFp = byKey.get(fpKey);
    const existing = existingByDoi ?? existingByFp;
    if (existing) {
      if (!existing.sources.some(s => s.adapter.id === adapter.id)) {
        existing.sources.push({ adapter, nativeId: paper.nativeId, url: paper.url });
      }
      // Promote richer abstract / DOI / pmid if the canonical record was missing them.
      if (!existing.doi && paper.doi) existing.doi = paper.doi;
      if (!existing.pmid && paper.pmid) existing.pmid = paper.pmid;
      if (existing.abstract.length < 200 && paper.abstract.length > existing.abstract.length) {
        existing.abstract = paper.abstract;
      }
      continue;
    }
    const c: CandidatePaper = {
      ...paper,
      fingerprint: fp,
      sources: [{ adapter, nativeId: paper.nativeId, url: paper.url }],
    };
    byKey.set(fpKey, c);
    if (doiKey) byKey.set(doiKey, c);
  }

  // Use a Set on object identity to extract uniques from possibly-duplicated map values.
  const uniques = Array.from(new Set(byKey.values()));
  return { candidates: uniques, perSourceFound };
}

async function findExistingPaperIds(candidates: CandidatePaper[]): Promise<Map<string, number>> {
  // Lookup table: any signature → paperId. Lets us merge a freshly-fetched
  // candidate into a paper that already exists from a previous run.
  const result = new Map<string, number>();
  if (candidates.length === 0) return result;

  const dois = candidates.map(c => c.doi).filter((d): d is string => !!d);
  const pmids = candidates.map(c => c.pmid).filter((p): p is string => !!p);
  const fps = candidates.map(c => c.fingerprint);

  const existing = await db.select({
    id: papersTable.id,
    doi: papersTable.doi,
    pmid: papersTable.pmid,
    fingerprint: papersTable.fingerprint,
  }).from(papersTable).where(or(
    dois.length > 0 ? inArray(papersTable.doi, dois) : undefined,
    pmids.length > 0 ? inArray(papersTable.pmid, pmids) : undefined,
    fps.length > 0 ? inArray(papersTable.fingerprint, fps) : undefined,
  ));

  for (const row of existing) {
    if (row.doi) result.set(`doi:${row.doi.toLowerCase()}`, row.id);
    if (row.pmid) result.set(`pmid:${row.pmid}`, row.id);
    if (row.fingerprint) result.set(`fp:${row.fingerprint}`, row.id);
  }
  return result;
}

function existingIdFor(c: CandidatePaper, lookup: Map<string, number>): number | null {
  if (c.doi) {
    const id = lookup.get(`doi:${c.doi.toLowerCase()}`);
    if (id) return id;
  }
  if (c.pmid) {
    const id = lookup.get(`pmid:${c.pmid}`);
    if (id) return id;
  }
  return lookup.get(`fp:${c.fingerprint}`) ?? null;
}

async function recordPaperSources(paperId: number, sources: CandidatePaper["sources"]): Promise<void> {
  if (sources.length === 0) return;
  // ON CONFLICT DO NOTHING via the unique (paper_id, source_id) constraint.
  await db.insert(paperSourcesTable).values(sources.map(s => ({
    paperId,
    sourceId: s.adapter.id,
    nativeId: s.nativeId,
    url: s.url,
  }))).onConflictDoNothing();
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

  for (const { config } of configs) {
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
      papersDeduplicated: 0,
      fullTextFetched: 0,
      lowConfidenceClaims: 0,
      claimsExtracted: 0,
      errorsCount: 0,
      errors: [],
      perSourceCounts: {},
    };

    try {
      const sourceIds = (config.sources && config.sources.length > 0) ? config.sources : ["pubmed"];
      const adapters = getAdapters(sourceIds);
      if (adapters.length === 0) throw new Error(`No valid source adapters for config ${config.id}`);

      logger.info({ topicId: config.topicId, query: config.pubmedQuery, sources: sourceIds }, "Starting multi-source ingestion");

      const maxPerSource = Math.max(1, Math.ceil(config.maxPapersPerRun / adapters.length));
      const { candidates, perSourceFound } = await gatherCandidates(config.pubmedQuery, adapters, maxPerSource);
      result.perSourceCounts = perSourceFound;
      result.papersFound = candidates.length;

      const existingLookup = await findExistingPaperIds(candidates);
      const newCandidates: CandidatePaper[] = [];
      for (const c of candidates) {
        const existingId = existingIdFor(c, existingLookup);
        if (existingId) {
          // Already in DB: still record any newly-discovered sources so the
          // paper is attributed to every provider that surfaced it.
          await recordPaperSources(existingId, c.sources);
          result.papersDeduplicated++;
        } else {
          newCandidates.push(c);
        }
      }

      if (newCandidates.length === 0) {
        await db.update(ingestionRunsTable).set({
          status: "completed",
          papersFound: result.papersFound,
          papersDeduplicated: result.papersDeduplicated,
          perSourceCounts: result.perSourceCounts,
          completedAt: new Date(),
        }).where(eq(ingestionRunsTable.id, run.id));
        results.push(result);
        continue;
      }

      const batchProcess = await getBatchProcess();
      await batchProcess(
        newCandidates,
        async (paper) => {
          try {
            const methodologyType = inferMethodology(paper.abstract);
            const evidenceQuality = inferEvidenceQuality(methodologyType);

            // Best-effort full-text resolution. We never block on it for too
            // long (timeout inside fullTextExtractor) and downgrade gracefully.
            let fullText: { status: FullTextStatus; source: string | null; url: string | null; text: string | null } = {
              status: "skipped", source: null, url: paper.openAccessUrl, text: null,
            };
            try {
              fullText = await resolveFullText(paper.doi, paper.openAccessUrl);
              if (fullText.status === "fetched") result.fullTextFetched++;
            } catch (err) {
              logger.debug({ err, fingerprint: paper.fingerprint }, "Full-text resolution threw; continuing with abstract");
              fullText = { status: "failed", source: null, url: paper.openAccessUrl, text: null };
            }

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
              openAccessUrl: paper.openAccessUrl ?? fullText.url,
              rawAbstractXml: paper.rawXml,
              isPreprint: paper.isPreprint ? 1 : 0,
              fingerprint: paper.fingerprint,
              fullTextStatus: fullText.status,
              fullTextSource: fullText.source,
              fullTextUrl: fullText.url,
              fullText: fullText.text,
            }).returning();

            await recordPaperSources(insertedPaper.id, paper.sources);

            const claims = await extractClaims(
              { abstract: paper.abstract, methodsText: paper.methodsText ?? fullText.text ?? null },
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
              if (isDuplicate) continue;

              const status = claim.confidence < PENDING_CLAIM_THRESHOLD ? "pending" : "approved";
              if (status === "pending") result.lowConfidenceClaims++;

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
                confidence: claim.confidence,
                status,
              }).returning();

              void embedAndStoreClaim(insertedClaim.id, claim.claimText);
              await linkEvidence(insertedClaim.id, claim, config.topicId, insertedPaper.id);
              await refreshClaimSynthesis(insertedClaim.id, config.topicId);
              result.claimsExtracted++;
            }

            result.papersProcessed++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ err, fingerprint: paper.fingerprint }, "Failed to process paper");
            result.errorsCount++;
            result.errors.push(`${paper.fingerprint}: ${msg}`);
          }
        },
        { concurrency: 1, retries: 2 }
      );

      await db.update(ingestionRunsTable).set({
        status: "completed",
        papersFound: result.papersFound,
        papersProcessed: result.papersProcessed,
        papersDeduplicated: result.papersDeduplicated,
        fullTextFetched: result.fullTextFetched,
        lowConfidenceClaims: result.lowConfidenceClaims,
        claimsExtracted: result.claimsExtracted,
        errorsCount: result.errorsCount,
        errorDetails: result.errors.length > 0 ? result.errors.slice(0, 10).join("\n") : null,
        perSourceCounts: result.perSourceCounts,
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
        perSourceCounts: result.perSourceCounts,
        completedAt: new Date(),
      }).where(eq(ingestionRunsTable.id, run.id));
    }

    results.push(result);
  }

  // Surface a hint if any candidate has no fingerprint at all (legacy rows
  // missed by the migration backfill).
  const orphanCount = await db.select({ id: papersTable.id }).from(papersTable).where(and(isNotNull(papersTable.id))).limit(1);
  if (orphanCount.length === 0) logger.debug("No papers in DB yet");

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
