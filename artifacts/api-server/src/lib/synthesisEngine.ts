import {
  db,
  claimsTable,
  papersTable,
  evidenceLinksTable,
  studiesTable,
  claimSynthesisTable,
  questionSynthesisTable,
} from "@workspace/db";
import { eq, or, ilike, inArray, sql, and, lt, isNotNull } from "drizzle-orm";
import { createHash } from "crypto";
import { customAlphabet } from "nanoid";
import { logger } from "./logger";
import { embedText, toVectorLiteral } from "./embeddings";
import { recordLlmCall } from "./usage";

// URL-safe, unambiguous alphabet (no 0/O/1/l/I); 8 chars => ~47 bits entropy.
const generateShareId = customAlphabet(
  "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ",
  8,
);

const VECTOR_TOP_K = 20;
const VECTOR_MAX_DISTANCE = 0.6;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface MemoryCacheEntry {
  result: SynthesisResult;
  expiresAt: number;
}
const memoryCache = new Map<string, MemoryCacheEntry>();

export function _resetSynthesisMemoryCacheForTests(): void {
  memoryCache.clear();
}

export interface EvidenceItem {
  claimId: number;
  claimText: string;
  direction: string;
  methodologyType: string;
  evidenceQuality: string;
  population: string;
  effectSize: number | null;
  effectSizeUnit: string | null;
  sampleSize: number | null;
  paperTitle: string;
  paperAuthors: string;
  paperYear: number;
}

export interface StudySummary {
  claimText: string;
  direction: string;
  methodologyType: string;
  evidenceQuality: string;
  effectSize: number | null;
  effectSizeUnit: string | null;
  sampleSize: number | null;
  population: string;
  paperTitle: string;
  paperYear: number;
}

export interface SynthesisResult {
  question: string;
  questionHash: string;
  /** Short opaque slug used in shareable URLs (e.g. /?synthesis=abc12345). */
  shareId?: string;
  consensusStatus: string;
  synthesisText: string;
  moderatingVariables: string[];
  methodologicalConcerns: string[];
  uncertaintyScore: number;
  temporalTrend: string;
  supportingStudies: StudySummary[];
  contradictingStudies: StudySummary[];
  totalEvidence: number;
  cached: boolean;
}

export interface VerifyResult {
  claim: string;
  verdict: "supported" | "contested" | "contradicted" | "insufficient";
  confidence: number;
  matchedClaimText: string | null;
  matchedClaimId: number | null;
  supportingSummary: string;
  contradictingSummary: string;
}

export interface ContradictionEntry {
  evidenceLinkId: number;
  studyId: number;
  studyTitle: string;
  studyYear: number;
  studyAuthors: string;
  studyMethodologyType: string;
  studySampleSize: number | null;
  contradictionExplanation: string;
}

export interface ContradictionMapResult {
  claimId: number;
  claimText: string;
  contradictions: ContradictionEntry[];
}

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function questionHash(q: string): string {
  return createHash("sha256").update(normalizeQuestion(q)).digest("hex").slice(0, 16);
}

export async function getCachedSynthesis(q: string): Promise<SynthesisResult | null> {
  const hash = questionHash(q);
  const nowMs = Date.now();

  const memEntry = memoryCache.get(hash);
  if (memEntry) {
    if (memEntry.expiresAt > nowMs) {
      return { ...memEntry.result, cached: true };
    }
    memoryCache.delete(hash);
  }

  const now = new Date(nowMs);
  try {
    const rows = await db
      .select()
      .from(questionSynthesisTable)
      .where(eq(questionSynthesisTable.questionHash, hash))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    // Treat as a cache miss (forcing re-synthesis) when expired, but DO NOT
    // delete the row — share links are permanent, so the row must survive
    // beyond the cache TTL for `getSynthesisByShareId` to keep working.
    if (row.expiresAt <= now) {
      return null;
    }
    // Always overlay the row's authoritative shareId so older cached payloads
    // that pre-date the share feature still get one.
    const result = { ...(row.result as SynthesisResult), shareId: row.shareId, cached: true };
    memoryCache.set(hash, {
      result: { ...result, cached: false },
      expiresAt: row.expiresAt.getTime(),
    });
    return result;
  } catch (err) {
    logger.warn({ err }, "getCachedSynthesis DB error (non-fatal)");
    return null;
  }
}

/**
 * Persist a synthesis result. Mutates `result` in place to attach the
 * generated/looked-up `shareId` so callers can surface it immediately.
 * Returns the assigned shareId (best-effort — undefined if DB write failed
 * AND no prior shareId was attached).
 */
export async function cacheSynthesis(result: SynthesisResult): Promise<string | undefined> {
  const expiresAtMs = Date.now() + CACHE_TTL_MS;
  const expiresAt = new Date(expiresAtMs);
  const newShareId = result.shareId ?? generateShareId();
  const toStore = { ...result, shareId: newShareId, cached: false };

  try {
    const [row] = await db
      .insert(questionSynthesisTable)
      .values({
        questionHash: result.questionHash,
        shareId: newShareId,
        question: result.question,
        result: toStore,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: questionSynthesisTable.questionHash,
        // Preserve the original shareId on conflict so stale links keep working.
        set: { result: toStore, expiresAt, createdAt: new Date() },
      })
      .returning({ shareId: questionSynthesisTable.shareId });

    const finalShareId = row?.shareId ?? newShareId;
    // If the upsert hit an existing row, the DB column kept its original
    // shareId but the result JSON we just wrote contains `newShareId`.
    // Realign the JSON blob so column and payload always agree on disk.
    if (finalShareId !== newShareId) {
      const realigned = { ...toStore, shareId: finalShareId };
      await db
        .update(questionSynthesisTable)
        .set({ result: realigned })
        .where(eq(questionSynthesisTable.questionHash, result.questionHash));
      toStore.shareId = finalShareId;
    }
    result.shareId = finalShareId;
    toStore.shareId = finalShareId;
    memoryCache.set(result.questionHash, { result: toStore, expiresAt: expiresAtMs });
    return finalShareId;
  } catch (err) {
    logger.warn({ err }, "cacheSynthesis DB error (non-fatal)");
    memoryCache.set(result.questionHash, { result: toStore, expiresAt: expiresAtMs });
    return result.shareId;
  }
}

/**
 * Look up a stored synthesis by its public share slug. Share links are
 * intentionally permanent — `expiresAt` controls the re-synthesis cache
 * (see `getCachedSynthesis`) but does NOT gate share retrieval.
 */
export async function getSynthesisByShareId(shareId: string): Promise<SynthesisResult | null> {
  try {
    const rows = await db
      .select()
      .from(questionSynthesisTable)
      .where(eq(questionSynthesisTable.shareId, shareId))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return { ...(row.result as SynthesisResult), shareId: row.shareId, cached: true };
  } catch (err) {
    logger.warn({ err }, "getSynthesisByShareId DB error");
    return null;
  }
}

async function getOpenAI() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

const QUALITY_SCORES: Record<string, number> = { A: 90, B: 65, C: 40, D: 20 };

function avgQualityScore(evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 30;
  return (
    evidence.reduce((sum, e) => sum + (QUALITY_SCORES[e.evidenceQuality] ?? 30), 0) /
    evidence.length
  );
}

export function computeUncertaintyScore(evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 100;

  const totalCount = evidence.length;
  const avgQuality = avgQualityScore(evidence);
  const protective = evidence.filter((e) => e.direction === "protective").length;
  const harmful = evidence.filter((e) => e.direction === "harmful").length;
  const neutral = evidence.filter((e) => e.direction === "neutral").length;
  const directionalAgreement = Math.max(protective, harmful, neutral) / totalCount;
  const countScore = Math.min(1, totalCount / 10);

  const uncertainty = 100 - (
    countScore * 25 +
    (avgQuality / 100) * 35 +
    directionalAgreement * 40
  );
  return Math.max(5, Math.min(95, Math.round(uncertainty)));
}

export function computeTemporalTrend(evidence: EvidenceItem[]): string {
  if (evidence.length < 4) return "unclear";
  const currentYear = new Date().getFullYear();
  const recent = evidence.filter((e) => e.paperYear >= currentYear - 5);
  const older = evidence.filter((e) => e.paperYear < currentYear - 5);
  if (recent.length < 2 || older.length < 2) return "unclear";
  const recentAvg = avgQualityScore(recent);
  const olderAvg = avgQualityScore(older);
  if (recentAvg > olderAvg + 15) return "strengthening";
  if (olderAvg > recentAvg + 15) return "weakening";
  return "stable";
}

function sampleSizeSubquery() {
  return db
    .select({
      paperId: studiesTable.paperId,
      maxSampleSize: sql<number>`MAX(${studiesTable.sampleSize})`.as("max_sample_size"),
    })
    .from(studiesTable)
    .groupBy(studiesTable.paperId)
    .as("sample_sizes");
}

interface EvidenceRow {
  claimId: number;
  claimText: string;
  direction: string;
  methodologyType: string;
  evidenceQuality: string;
  population: string;
  effectSize: number | null;
  effectSizeUnit: string | null;
  paperTitle: string | null;
  paperAuthors: string | null;
  paperYear: number | null;
  sampleSize: number | null;
}

function toEvidenceItem(r: EvidenceRow): EvidenceItem {
  return {
    claimId: r.claimId,
    claimText: r.claimText,
    direction: r.direction,
    methodologyType: r.methodologyType,
    evidenceQuality: r.evidenceQuality,
    population: r.population,
    effectSize: r.effectSize,
    effectSizeUnit: r.effectSizeUnit,
    sampleSize: r.sampleSize ?? null,
    paperTitle: r.paperTitle ?? "Unknown",
    paperAuthors: r.paperAuthors ?? "Unknown",
    paperYear: r.paperYear ?? 0,
  };
}

async function retrieveByVector(
  question: string,
  recordCtx?: { userId?: string | null; requestId?: string | null; route?: string },
): Promise<EvidenceItem[] | null> {
  // Pass user/request context so retrieval embeddings count against the
  // calling user's daily quota and show up in /admin/usage attribution.
  const queryVec = await embedText(question, recordCtx);
  if (!queryVec) return null;
  const literal = toVectorLiteral(queryVec);
  const sampleSubq = sampleSizeSubquery();

  try {
    const rows = await db
      .select({
        claimId: claimsTable.id,
        claimText: claimsTable.claimText,
        direction: claimsTable.direction,
        methodologyType: claimsTable.methodologyType,
        evidenceQuality: claimsTable.evidenceQuality,
        population: claimsTable.population,
        effectSize: claimsTable.effectSize,
        effectSizeUnit: claimsTable.effectSizeUnit,
        paperTitle: papersTable.title,
        paperAuthors: papersTable.authors,
        paperYear: papersTable.publicationYear,
        sampleSize: sampleSubq.maxSampleSize,
        distance: sql<number>`${claimsTable.embedding} <=> ${literal}::vector`.as("distance"),
      })
      .from(claimsTable)
      .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
      .leftJoin(sampleSubq, eq(sampleSubq.paperId, claimsTable.paperId))
      .where(isNotNull(claimsTable.embedding))
      .orderBy(sql`${claimsTable.embedding} <=> ${literal}::vector`)
      .limit(VECTOR_TOP_K);

    const filtered = rows.filter((r) => r.distance <= VECTOR_MAX_DISTANCE);
    // Return [] (not null) when the query ran successfully but produced no
    // in-threshold matches — null is reserved for "vector path unavailable".
    return filtered.map(toEvidenceItem);
  } catch (err) {
    logger.warn({ err }, "Vector retrieval failed; falling back to keyword search");
    return null;
  }
}

async function retrieveByKeywords(
  question: string,
  opts: { onlyMissingEmbedding?: boolean } = {},
): Promise<EvidenceItem[]> {
  const terms = normalizeQuestion(question)
    .split(" ")
    .filter((t) => t.length > 3)
    .slice(0, 8);

  if (terms.length === 0) return [];

  const termConditions = terms.flatMap((term) => {
    const pat = `%${term}%`;
    return [
      ilike(claimsTable.claimText, pat),
      ilike(papersTable.abstract, pat),
      ilike(papersTable.title, pat),
    ];
  });

  const sampleSubq = sampleSizeSubquery();

  let scoreExpr = sql<number>`0`;
  for (const term of terms) {
    const pat = `%${term}%`;
    scoreExpr = sql`${scoreExpr}
      + CASE WHEN ${claimsTable.claimText} ILIKE ${pat} THEN 5 ELSE 0 END
      + CASE WHEN ${papersTable.title} ILIKE ${pat} THEN 2 ELSE 0 END
      + CASE WHEN ${papersTable.abstract} ILIKE ${pat} THEN 1 ELSE 0 END`;
  }

  const rows = await db
    .select({
      claimId: claimsTable.id,
      claimText: claimsTable.claimText,
      direction: claimsTable.direction,
      methodologyType: claimsTable.methodologyType,
      evidenceQuality: claimsTable.evidenceQuality,
      population: claimsTable.population,
      effectSize: claimsTable.effectSize,
      effectSizeUnit: claimsTable.effectSizeUnit,
      paperTitle: papersTable.title,
      paperAuthors: papersTable.authors,
      paperYear: papersTable.publicationYear,
      sampleSize: sampleSubq.maxSampleSize,
    })
    .from(claimsTable)
    .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
    .leftJoin(sampleSubq, eq(sampleSubq.paperId, claimsTable.paperId))
    .where(
      opts.onlyMissingEmbedding
        ? and(or(...termConditions), sql`${claimsTable.embedding} IS NULL`)
        : or(...termConditions),
    )
    .orderBy(sql`(${scoreExpr}) DESC`, claimsTable.id)
    .limit(VECTOR_TOP_K);

  return rows.map(toEvidenceItem);
}

/**
 * Hybrid retrieval:
 *  - Run cosine-similarity vector search over claims that already have an
 *    embedding.
 *  - Concurrently run a keyword (ilike) search restricted to claims that
 *    do NOT yet have an embedding, so backfill-in-progress data is still
 *    discoverable.
 *  - Merge & dedupe by claimId (vector wins), then cap at VECTOR_TOP_K.
 *  - If the embedding call fails (no key, network error, etc.), fall back
 *    to a single unrestricted keyword search over all claims.
 */
export async function retrieveRelevantEvidence(
  question: string,
  recordCtx?: { userId?: string | null; requestId?: string | null; route?: string },
): Promise<EvidenceItem[]> {
  const [vectorResults, keywordForUnembedded] = await Promise.all([
    retrieveByVector(question, recordCtx),
    retrieveByKeywords(question, { onlyMissingEmbedding: true }),
  ]);

  if (vectorResults === null) {
    const keywordResults = await retrieveByKeywords(question);
    logger.debug(
      { count: keywordResults.length },
      "Retrieved evidence via keyword fallback (vector unavailable)",
    );
    return keywordResults;
  }

  const seen = new Set<number>();
  const merged: EvidenceItem[] = [];
  for (const item of vectorResults) {
    if (seen.has(item.claimId)) continue;
    seen.add(item.claimId);
    merged.push(item);
  }
  for (const item of keywordForUnembedded) {
    if (seen.has(item.claimId)) continue;
    seen.add(item.claimId);
    merged.push(item);
  }

  logger.debug(
    {
      vector: vectorResults.length,
      keywordUnembedded: keywordForUnembedded.length,
      merged: merged.length,
    },
    "Retrieved evidence via hybrid vector + keyword search",
  );

  return merged.slice(0, VECTOR_TOP_K);
}

const SYNTHESIS_SYSTEM_PROMPT = `You are a scientific evidence synthesizer. Given a research question and indexed evidence items, produce a structured synthesis as JSON.

Return a JSON object with EXACTLY these fields:
- consensusStatus: "well-established" | "contested" | "preliminary" | "insufficient evidence"
  well-established = strong majority of high-quality evidence agrees
  contested = significant evidence on both sides
  preliminary = few studies, directionally consistent but limited
  insufficient evidence = not enough relevant evidence
- synthesisText: 2–4 sentences summarizing what the evidence says about the question (plain language)
- moderatingVariables: array of strings — key factors that modify the effect (e.g. ["age group", "dosage", "duration"])
- methodologicalConcerns: array of strings — limitations (e.g. ["most studies cross-sectional", "small samples"])
- supportingIndices: array of 0-based indices from the evidence list that SUPPORT the question's hypothesis
- contradictingIndices: array of 0-based indices from the evidence list that CONTRADICT the question's hypothesis

Be conservative and evidence-based. Do not invent information not in the provided evidence.`;

export async function synthesizeQuestion(
  question: string,
  evidence: EvidenceItem[],
  onToken: (token: string) => void,
  recordCtx?: { userId?: string | null; requestId?: string | null },
): Promise<SynthesisResult> {
  const openai = await getOpenAI();

  const contextLines = evidence
    .map(
      (e, i) =>
        `[${i}] "${e.claimText}" | direction=${e.direction} | method=${e.methodologyType} | quality=Grade${e.evidenceQuality} | n=${e.sampleSize ?? "?"} | population="${e.population}" | paper="${e.paperTitle}" (${e.paperYear})`,
    )
    .join("\n");

  const SYNTH_MODEL = "gpt-4o-mini";
  // Rough char-based token estimate so streamed calls (which don't expose a
  // `usage` block) still record realistic spend in usage_events.
  const promptText =
    `${SYNTHESIS_SYSTEM_PROMPT}\nQuestion: "${question}"\n\nEvidence items (0-indexed):\n${contextLines}`;
  const estimatedInputTokens = Math.max(1, Math.ceil(promptText.length / 4));

  // Single chokepoint: wrap BOTH the create() and the stream consumption in
  // recordLlmCall so failures during stream creation/iteration still write a
  // usage_events row (best-effort, with failed=true) — matching every other
  // OpenAI call in this codebase.
  let fullContent = "";
  await recordLlmCall(
    async () => {
      const stream = await openai.chat.completions.create({
        model: SYNTH_MODEL,
        messages: [
          { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Question: "${question}"\n\nEvidence items (0-indexed):\n${contextLines}\n\nReturn JSON synthesis.`,
          },
        ],
        response_format: { type: "json_object" },
        stream: true,
        temperature: 0.2,
        max_completion_tokens: 1500,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          fullContent += delta;
          onToken(delta);
        }
      }
      // Returning a synthetic `usage` block lets recordLlmCall compute cost
      // without a separate code path.
      return {
        usage: {
          input_tokens: estimatedInputTokens,
          output_tokens: Math.max(1, Math.ceil(fullContent.length / 4)),
        },
      };
    },
    {
      route: "synthesisEngine.synthesizeQuestion",
      model: SYNTH_MODEL,
      userId: recordCtx?.userId ?? null,
      requestId: recordCtx?.requestId ?? null,
    },
  );

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(fullContent) as Record<string, unknown>;
  } catch (err) {
    logger.error({ err, fullContent }, "Failed to parse synthesis LLM response");
  }

  const toNum = (v: unknown): number[] =>
    Array.isArray(v)
      ? (v as unknown[]).filter(
          (x): x is number => typeof x === "number" && x >= 0 && x < evidence.length,
        )
      : [];

  const supportingIndices = toNum(parsed.supportingIndices);
  const contradictingIndices = toNum(parsed.contradictingIndices);

  const toSummary = (e: EvidenceItem): StudySummary => ({
    claimText: e.claimText,
    direction: e.direction,
    methodologyType: e.methodologyType,
    evidenceQuality: e.evidenceQuality,
    effectSize: e.effectSize,
    effectSizeUnit: e.effectSizeUnit,
    sampleSize: e.sampleSize,
    population: e.population,
    paperTitle: e.paperTitle,
    paperYear: e.paperYear,
  });

  const hash = questionHash(question);

  const uncertaintyScore = computeUncertaintyScore(evidence);
  const temporalTrend = computeTemporalTrend(evidence);

  return {
    question,
    questionHash: hash,
    consensusStatus:
      typeof parsed.consensusStatus === "string" ? parsed.consensusStatus : "insufficient",
    synthesisText:
      typeof parsed.synthesisText === "string" ? parsed.synthesisText : "Synthesis unavailable.",
    moderatingVariables: Array.isArray(parsed.moderatingVariables)
      ? (parsed.moderatingVariables as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    methodologicalConcerns: Array.isArray(parsed.methodologicalConcerns)
      ? (parsed.methodologicalConcerns as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    uncertaintyScore,
    temporalTrend,
    supportingStudies: supportingIndices.map((i) => toSummary(evidence[i])),
    contradictingStudies: contradictingIndices.map((i) => toSummary(evidence[i])),
    totalEvidence: evidence.length,
    cached: false,
  };
}

export async function verifyClaimText(
  claimText: string,
  recordCtx?: { userId?: string | null; requestId?: string | null },
): Promise<VerifyResult> {
  // Forward user attribution so the embedding fired during verify counts
  // against the caller's daily quota (otherwise verify could be used to
  // bypass the synthesis quota cap).
  const evidence = await retrieveRelevantEvidence(claimText, {
    ...recordCtx,
    route: "synthesisEngine.verifyClaimText",
  });

  if (evidence.length === 0) {
    return {
      claim: claimText,
      verdict: "insufficient",
      confidence: 0,
      matchedClaimText: null,
      matchedClaimId: null,
      supportingSummary: "No relevant evidence found in the knowledge base.",
      contradictingSummary: "",
    };
  }

  const bestClaim = evidence[0];

  const syntheses = await db
    .select()
    .from(claimSynthesisTable)
    .where(
      inArray(
        claimSynthesisTable.claimId,
        evidence.slice(0, 5).map((e) => e.claimId),
      ),
    )
    .limit(5);

  const bestSynthesis = syntheses.find((s) => s.claimId === bestClaim.claimId) ?? syntheses[0];

  if (!bestSynthesis) {
    return {
      claim: claimText,
      verdict: "insufficient",
      confidence: 15,
      matchedClaimText: bestClaim.claimText,
      matchedClaimId: bestClaim.claimId,
      supportingSummary: `Found a related claim: "${bestClaim.claimText}" (${bestClaim.direction}, Grade ${bestClaim.evidenceQuality}). No synthesis has been generated for this claim yet.`,
      contradictingSummary: "",
    };
  }

  const supporting = bestSynthesis.supportingCount ?? 0;
  const contradicting = bestSynthesis.contradictingCount ?? 0;
  const total = supporting + contradicting;

  let verdict: VerifyResult["verdict"];
  if (total > 0 && contradicting > supporting && contradicting / total > 0.6) {
    verdict = "contradicted";
  } else if (bestSynthesis.consensusStatus === "well-established" || bestSynthesis.consensusStatus === "preliminary") {
    verdict = "supported";
  } else if (bestSynthesis.consensusStatus === "contested") {
    verdict = "contested";
  } else {
    verdict = "insufficient";
  }

  const confidence = Math.max(10, Math.round(100 - (bestSynthesis.uncertaintyScore ?? 50)));

  const supportingSummary = bestSynthesis.synthesisText;
  const contradictingSummary =
    bestSynthesis.contradictingCount > 0
      ? `There are ${bestSynthesis.contradictingCount} contradicting studies. ${
          bestSynthesis.methodologicalConcerns
            ? "Methodological concerns: " + bestSynthesis.methodologicalConcerns
            : ""
        }`.trim()
      : "";

  return {
    claim: claimText,
    verdict,
    confidence,
    matchedClaimText: bestClaim.claimText,
    matchedClaimId: bestClaim.claimId,
    supportingSummary,
    contradictingSummary,
  };
}

const CONTRADICTION_SYSTEM_PROMPT = `You are a scientific methodologist. Given a claim and a contradicting study, explain concisely WHY they disagree.

Return JSON with:
- explanation: 1–2 sentences explaining the contradiction. Focus on: population differences, methodological differences, time period, operational definitions, confounders. Be specific and cite the actual differences.`;

export async function generateContradictionExplanation(
  claimText: string,
  studyTitle: string,
  studyMethodology: string,
  studyPopulation: string,
  claimPopulation: string,
): Promise<string> {
  const openai = await getOpenAI();
  const CONTRADICTION_MODEL = "gpt-4o-mini";

  const response = await recordLlmCall(
    () =>
      openai.chat.completions.create({
        model: CONTRADICTION_MODEL,
        messages: [
          { role: "system", content: CONTRADICTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Claim: "${claimText}" (population: "${claimPopulation}")
Contradicting study: "${studyTitle}" — method: ${studyMethodology}, population: "${studyPopulation}"

Why do they contradict each other? Return JSON.`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_completion_tokens: 200,
      }),
    { route: "synthesisEngine.generateContradictionExplanation", model: CONTRADICTION_MODEL },
  );

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content) as { explanation?: unknown };
    if (typeof parsed.explanation === "string" && parsed.explanation.length > 0) {
      return parsed.explanation;
    }
  } catch {
    /* fall through */
  }
  return "The studies differ in methodology or population characteristics.";
}

export async function buildContradictionMap(claimId: number): Promise<ContradictionMapResult> {
  const claim = await db
    .select({
      id: claimsTable.id,
      claimText: claimsTable.claimText,
      population: claimsTable.population,
    })
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId))
    .limit(1);

  if (claim.length === 0) {
    return { claimId, claimText: "", contradictions: [] };
  }

  const links = await db
    .select()
    .from(evidenceLinksTable)
    .leftJoin(studiesTable, eq(evidenceLinksTable.studyId, studiesTable.id))
    .where(eq(evidenceLinksTable.claimId, claimId));

  const contradictingLinks = links.filter(
    (l) => l.evidence_links.direction === "contradicting" && l.studies,
  );

  const result: ContradictionEntry[] = [];

  for (const link of contradictingLinks) {
    const study = link.studies!;
    let explanation = link.evidence_links.contradictionExplanation;

    if (!explanation) {
      try {
        explanation = await generateContradictionExplanation(
          claim[0].claimText,
          study.title,
          study.methodologyType,
          study.population,
          claim[0].population ?? "",
        );
        await db
          .update(evidenceLinksTable)
          .set({ contradictionExplanation: explanation })
          .where(eq(evidenceLinksTable.id, link.evidence_links.id));
      } catch (err) {
        logger.warn(
          { err, claimId, linkId: link.evidence_links.id },
          "Failed to generate contradiction explanation",
        );
        explanation = "Contradiction explanation unavailable.";
      }
    }

    result.push({
      evidenceLinkId: link.evidence_links.id,
      studyId: study.id,
      studyTitle: study.title,
      studyYear: study.publicationYear,
      studyAuthors: study.authors,
      studyMethodologyType: study.methodologyType,
      studySampleSize: study.sampleSize,
      contradictionExplanation: explanation ?? "Contradiction explanation unavailable.",
    });
  }

  return {
    claimId,
    claimText: claim[0].claimText,
    contradictions: result,
  };
}
