import { db, claimsTable, papersTable, evidenceLinksTable, studiesTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./logger";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  result: SynthesisResult;
  expiresAt: number;
}

const synthesisCache = new Map<string, CacheEntry>();

export interface EvidenceItem {
  claimId: number;
  claimText: string;
  direction: string;
  methodologyType: string;
  evidenceQuality: string;
  population: string;
  effectSize: number | null;
  effectSizeUnit: string | null;
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

export function getCachedSynthesis(q: string): SynthesisResult | null {
  const hash = questionHash(q);
  const entry = synthesisCache.get(hash);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) synthesisCache.delete(hash);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function cacheSynthesis(result: SynthesisResult): void {
  synthesisCache.set(result.questionHash, {
    result: { ...result, cached: false },
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function getOpenAI() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

export async function retrieveRelevantEvidence(question: string): Promise<EvidenceItem[]> {
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
    })
    .from(claimsTable)
    .leftJoin(papersTable, eq(claimsTable.paperId, papersTable.id))
    .where(or(...termConditions))
    .limit(20);

  return rows.map((r) => ({
    claimId: r.claimId,
    claimText: r.claimText,
    direction: r.direction,
    methodologyType: r.methodologyType,
    evidenceQuality: r.evidenceQuality,
    population: r.population,
    effectSize: r.effectSize,
    effectSizeUnit: r.effectSizeUnit,
    paperTitle: r.paperTitle ?? "Unknown",
    paperAuthors: r.paperAuthors ?? "Unknown",
    paperYear: r.paperYear ?? 0,
  }));
}

const SYNTHESIS_SYSTEM_PROMPT = `You are a scientific evidence synthesizer. Given a research question and indexed evidence items, produce a structured synthesis as JSON.

Return a JSON object with EXACTLY these fields:
- consensusStatus: "well-established" | "contested" | "preliminary" | "insufficient"
  well-established = strong majority of high-quality evidence agrees
  contested = significant evidence on both sides
  preliminary = few studies, directionally consistent but limited
  insufficient = not enough relevant evidence
- synthesisText: 2–4 sentences summarizing what the evidence says about the question (plain language)
- moderatingVariables: array of strings — key factors that modify the effect (e.g. ["age group", "dosage", "duration"])
- methodologicalConcerns: array of strings — limitations (e.g. ["most studies cross-sectional", "small samples"])
- uncertaintyScore: integer 0–100 (0=very certain, 100=highly uncertain). Consider study count, quality, and directional agreement.
- temporalTrend: "strengthening" | "weakening" | "stable" | "unclear" — whether evidence has changed over time
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
        `[${i}] "${e.claimText}" | direction=${e.direction} | method=${e.methodologyType} | quality=Grade${e.evidenceQuality} | population="${e.population}" | paper="${e.paperTitle}" (${e.paperYear})`,
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
      ? (v as unknown[])
          .filter((x): x is number => typeof x === "number" && x >= 0 && x < evidence.length)
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
    population: e.population,
    paperTitle: e.paperTitle,
    paperYear: e.paperYear,
  });

  const hash = questionHash(question);
  return {
    question,
    questionHash: hash,
    consensusStatus:
      typeof parsed.consensusStatus === "string" ? parsed.consensusStatus : "insufficient",
    synthesisText:
      typeof parsed.synthesisText === "string" ? parsed.synthesisText : "Synthesis unavailable.",
    moderatingVariables: Array.isArray(parsed.moderatingVariables)
      ? (parsed.moderatingVariables as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    methodologicalConcerns: Array.isArray(parsed.methodologicalConcerns)
      ? (parsed.methodologicalConcerns as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    uncertaintyScore:
      typeof parsed.uncertaintyScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.uncertaintyScore)))
        : 50,
    temporalTrend: typeof parsed.temporalTrend === "string" ? parsed.temporalTrend : "unclear",
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

  const openai = await getOpenAI();
  const contextLines = evidence
    .slice(0, 10)
    .map(
      (e, i) =>
        `[${i}] "${e.claimText}" | direction=${e.direction} | quality=Grade${e.evidenceQuality} | method=${e.methodologyType}`,
    )
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a scientific fact-checker. Assess whether a claim is supported by the provided evidence.

Return JSON with:
- verdict: "supported" | "contested" | "contradicted" | "insufficient"
- confidence: integer 0-100 (confidence in the verdict)
- bestMatchIndex: 0-based index of the most relevant evidence item (-1 if none)
- supportingSummary: 1-2 sentences summarizing supporting evidence (empty string if none)
- contradictingSummary: 1-2 sentences summarizing contradicting evidence (empty string if none)`,
      },
      {
        role: "user",
        content: `Claim: "${claimText}"\n\nEvidence:\n${contextLines}\n\nReturn JSON assessment.`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 500,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    logger.error({ content }, "Failed to parse verify LLM response");
  }

  const bestMatchIndex =
    typeof parsed.bestMatchIndex === "number" ? parsed.bestMatchIndex : -1;
  const bestMatch =
    bestMatchIndex >= 0 && bestMatchIndex < evidence.length
      ? evidence[bestMatchIndex]
      : null;

  const VALID_VERDICTS = ["supported", "contested", "contradicted", "insufficient"] as const;
  const rawVerdict = parsed.verdict as string;
  const verdict = (
    VALID_VERDICTS.includes(rawVerdict as (typeof VALID_VERDICTS)[number])
      ? rawVerdict
      : "insufficient"
  ) as VerifyResult["verdict"];

  return {
    claim: claimText,
    verdict,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 0,
    matchedClaimText: bestMatch?.claimText ?? null,
    matchedClaimId: bestMatch?.claimId ?? null,
    supportingSummary:
      typeof parsed.supportingSummary === "string" ? parsed.supportingSummary : "",
    contradictingSummary:
      typeof parsed.contradictingSummary === "string" ? parsed.contradictingSummary : "",
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
    .select({ id: claimsTable.id, claimText: claimsTable.claimText, population: claimsTable.population })
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
        logger.warn({ err, claimId, linkId: link.evidence_links.id }, "Failed to generate contradiction explanation");
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
