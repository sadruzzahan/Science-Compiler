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
import { logger } from "./logger";
import { embedText, toVectorLiteral } from "./embeddings";

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
    if (row.expiresAt <= now) {
      await db.delete(questionSynthesisTable).where(eq(questionSynthesisTable.id, row.id));
      return null;
    }
    const result = { ...(row.result as SynthesisResult), cached: true };
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

export async function cacheSynthesis(result: SynthesisResult): Promise<void> {
  const expiresAtMs = Date.now() + CACHE_TTL_MS;
  const expiresAt = new Date(expiresAtMs);
  const toStore = { ...result, cached: false };

  memoryCache.set(result.questionHash, { result: toStore, expiresAt: expiresAtMs });

  try {
    await db
      .insert(questionSynthesisTable)
      .values({
        questionHash: result.questionHash,
        question: result.question,
        result: toStore,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: questionSynthesisTable.questionHash,
        set: { result: toStore, expiresAt, createdAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err }, "cacheSynthesis DB error (non-fatal)");
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

async function retrieveByVector(question: string): Promise<EvidenceItem[] | null> {
  const queryVec = await embedText(question);
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
    if (filtered.length === 0) return null;
    return filtered.map(toEvidenceItem);
  } catch (err) {
    logger.warn({ err }, "Vector retrieval failed; falling back to keyword search");
    return null;
  }
}

async function retrieveByKeywords(question: string): Promise<EvidenceItem[]> {
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
    .where(or(...termConditions))
    .orderBy(sql`(${scoreExpr}) DESC`, claimsTable.id)
    .limit(VECTOR_TOP_K);

  return rows.map(toEvidenceItem);
}

export async function retrieveRelevantEvidence(question: string): Promise<EvidenceItem[]> {
  const vectorResults = await retrieveByVector(question);
  if (vectorResults && vectorResults.length > 0) {
    logger.debug({ count: vectorResults.length }, "Retrieved evidence via vector search");
    return vectorResults;
  }
  const keywordResults = await retrieveByKeywords(question);
  logger.debug({ count: keywordResults.length }, "Retrieved evidence via keyword fallback");
  return keywordResults;
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
): Promise<SynthesisResult> {
  const openai = await getOpenAI();

  const contextLines = evidence
    .map(
      (e, i) =>
        `[${i}] "${e.claimText}" | direction=${e.direction} | method=${e.methodologyType} | quality=Grade${e.evidenceQuality} | n=${e.sampleSize ?? "?"} | population="${e.population}" | paper="${e.paperTitle}" (${e.paperYear})`,
    )
    .join("\n");

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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

  let fullContent = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    if (delta) {
      fullContent += delta;
      onToken(delta);
    }
  }

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

export async function verifyClaimText(claimText: string): Promise<VerifyResult> {
  const evidence = await retrieveRelevantEvidence(claimText);

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

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
  });

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
