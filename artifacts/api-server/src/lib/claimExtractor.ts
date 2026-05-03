import { logger } from "./logger";
import { recordLlmCall } from "./usage";

async function getOpenAI() {
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  return openai;
}

export interface ExtractedClaim {
  claimText: string;
  direction: "protective" | "harmful" | "neutral" | "mixed";
  effectSize: number | null;
  effectSizeUnit: string | null;
  ciLower: number | null;
  ciUpper: number | null;
  population: string;
  conditions: string | null;
  methodologyType: string;
  evidenceQuality: "A" | "B" | "C" | "D";
  // Self-reported extractor confidence in [0, 1]. Drives the review queue.
  confidence: number;
}

const SYSTEM_PROMPT = `You are a scientific claim extractor. Given the abstract (and optionally the methods section) of a scientific paper, extract the key empirical claims as structured JSON.

For each claim:
- claimText: concise statement of the finding (max 150 chars)
- direction: "protective" (reduces harm/risk), "harmful" (increases harm/risk), "neutral" (no significant effect), or "mixed"
- effectSize: numeric effect size if reported (OR, RR, HR, Cohen's d, etc.) — null if not available
- effectSizeUnit: label for the effect size (e.g. "OR", "RR", "HR", "Cohen's d", "mean difference") — null if not available
- ciLower: lower bound of 95% CI — null if not available
- ciUpper: upper bound of 95% CI — null if not available
- population: brief description of study population (max 80 chars)
- conditions: key conditions or caveats (max 100 chars) — null if none
- methodologyType: one of "rct", "meta-analysis", "cohort", "case-control", "cross-sectional", "observational", "review", "case-report"
- evidenceQuality: "A" (systematic review/RCT), "B" (cohort/well-designed), "C" (observational/case-control), "D" (case report/expert opinion)
- confidence: number in [0, 1] reflecting how directly the paper supports this claim. Use ≥0.9 only when the abstract states the finding plainly with effect size and CI; 0.7–0.9 for clearly stated qualitative findings; below 0.7 for inferred / hedged / partial extractions.

Use the methods section (when provided) to improve accuracy of methodologyType, population, and evidenceQuality fields.

Return a JSON object: { "claims": [...] }. Extract 1–5 most important claims. Only include claims with direct empirical support from the paper.`;

export interface PaperText {
  abstract: string;
  methodsText: string | null;
}

export async function extractClaims(paperText: PaperText | string, model: string = "gpt-5-mini"): Promise<ExtractedClaim[]> {
  const text = typeof paperText === "string"
    ? `ABSTRACT:\n${paperText}`
    : buildInputText(paperText);

  const openai = await getOpenAI();
  const response = await recordLlmCall(
    () =>
      openai.chat.completions.create({
        model,
        max_completion_tokens: 2000,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Extract claims from this paper text:\n\n${text}` },
        ],
        response_format: { type: "json_object" },
      }),
    { route: "claimExtractor.extractClaims", model },
  );

  const content = response.choices[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(content) as { claims?: unknown[] };
    const claims = parsed.claims;
    if (!Array.isArray(claims)) {
      logger.warn({ content }, "LLM returned no claims array");
      return [];
    }
    return claims
      .map(normalizeClaim)
      .filter((c): c is ExtractedClaim => c !== null)
      .slice(0, 5);
  } catch (err) {
    logger.error({ err, content }, "Failed to parse LLM claim extraction response");
    return [];
  }
}

function buildInputText({ abstract, methodsText }: PaperText): string {
  const parts: string[] = [`ABSTRACT:\n${abstract}`];
  if (methodsText && methodsText.length > 20) {
    parts.push(`\nMETHODS:\n${methodsText}`);
  }
  return parts.join("\n");
}

function normalizeClaim(c: unknown): ExtractedClaim | null {
  if (typeof c !== "object" || c === null) return null;
  const obj = c as Record<string, unknown>;
  if (
    !(typeof obj.claimText === "string" && obj.claimText.length > 10) ||
    !["protective", "harmful", "neutral", "mixed"].includes(obj.direction as string) ||
    !(typeof obj.population === "string" && obj.population.length > 0) ||
    !(typeof obj.methodologyType === "string") ||
    !["A", "B", "C", "D"].includes(obj.evidenceQuality as string)
  ) return null;
  // Coerce confidence (LLM may omit, return strings, or values outside [0, 1]).
  const rawConf = obj.confidence;
  let confidence = typeof rawConf === "number" ? rawConf : typeof rawConf === "string" ? parseFloat(rawConf) : NaN;
  if (!Number.isFinite(confidence)) confidence = 0.8;
  confidence = Math.min(1, Math.max(0, confidence));
  return { ...(obj as unknown as ExtractedClaim), confidence };
}
