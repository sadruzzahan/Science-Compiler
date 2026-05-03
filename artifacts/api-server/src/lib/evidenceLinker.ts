import { db, claimsTable, claimSynthesisTable, studiesTable, evidenceLinksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { ExtractedClaim } from "./claimExtractor";
import { logger } from "./logger";

const DIRECTION_OPPOSITES: Record<string, string[]> = {
  protective: ["harmful"],
  harmful: ["protective"],
  neutral: [],
  mixed: [],
};

export async function linkEvidence(
  newClaimId: number,
  newClaim: ExtractedClaim,
  topicId: number,
  paperId: number,
): Promise<void> {
  const existingClaims = await db.select().from(claimsTable).where(
    and(eq(claimsTable.topicId, topicId))
  );

  for (const existing of existingClaims) {
    if (existing.id === newClaimId) continue;

    const semanticallyRelated = claimsOverlap(newClaim.claimText, existing.claimText);
    if (!semanticallyRelated) continue;

    const opposites = DIRECTION_OPPOSITES[newClaim.direction] ?? [];
    const isContradicting = opposites.includes(existing.direction);
    const linkDirection = isContradicting ? "contradicting" : "supporting";

    const study = await db.insert(studiesTable).values({
      paperId,
      topicId,
      title: `Evidence from ingested paper: ${newClaim.claimText.slice(0, 60)}...`,
      authors: "Via PubMed ingestion",
      publicationYear: new Date().getFullYear(),
      methodologyType: newClaim.methodologyType,
      sampleSize: null,
      effectSize: newClaim.effectSize,
      effectSizeUnit: newClaim.effectSizeUnit,
      ciLower: newClaim.ciLower,
      ciUpper: newClaim.ciUpper,
      pValue: null,
      evidenceQuality: newClaim.evidenceQuality,
      population: newClaim.population,
      preregistered: 0,
    }).returning();

    await db.insert(evidenceLinksTable).values({
      claimId: existing.id,
      studyId: study[0].id,
      direction: linkDirection,
      contradictionExplanation: isContradicting
        ? `New ingested paper claims opposite direction (${newClaim.direction} vs ${existing.direction}).`
        : null,
    }).onConflictDoNothing();

    await refreshClaimSynthesis(existing.id, topicId);
  }
}

export async function refreshClaimSynthesis(claimId: number, topicId: number): Promise<void> {
  try {
    const links = await db.select({ direction: evidenceLinksTable.direction }).from(evidenceLinksTable).where(eq(evidenceLinksTable.claimId, claimId));
    const supporting = links.filter(l => l.direction === "supporting").length;
    const contradicting = links.filter(l => l.direction === "contradicting").length;
    const total = supporting + contradicting;
    const consensusRatio = total > 0 ? supporting / total : 0.5;

    let consensusStatus: string;
    if (consensusRatio >= 0.8 && total >= 3) consensusStatus = "well-established";
    else if (contradicting > supporting) consensusStatus = "contested";
    else if (total < 2) consensusStatus = "preliminary";
    else consensusStatus = "contested";

    const uncertaintyScore = Math.round((1 - consensusRatio) * 100);

    const existing = await db.select().from(claimSynthesisTable).where(eq(claimSynthesisTable.claimId, claimId));
    if (existing.length > 0) {
      await db.update(claimSynthesisTable).set({
        supportingCount: supporting,
        contradictingCount: contradicting,
        consensusStatus,
        uncertaintyScore,
        lastUpdated: new Date(),
      }).where(eq(claimSynthesisTable.claimId, claimId));
    } else {
      await db.insert(claimSynthesisTable).values({
        claimId,
        topicId,
        consensusStatus,
        synthesisText: "Auto-generated synthesis from ingested evidence.",
        supportingCount: supporting,
        contradictingCount: contradicting,
        uncertaintyScore,
        moderatingVariables: null,
        methodologicalConcerns: "Evidence sourced via automated PubMed ingestion; verify manually.",
        temporalTrend: null,
      });
    }
  } catch (err) {
    logger.warn({ err, claimId }, "Failed to refresh claim synthesis");
  }
}

function claimsOverlap(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 4);
  const wordsA = new Set(normalize(a));
  const wordsB = normalize(b);
  const overlap = wordsB.filter(w => wordsA.has(w));
  return overlap.length >= 2;
}
