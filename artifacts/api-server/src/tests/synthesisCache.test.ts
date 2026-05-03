import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, questionSynthesisTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  getCachedSynthesis,
  cacheSynthesis,
  questionHash,
  _resetSynthesisMemoryCacheForTests,
  type SynthesisResult,
} from "../lib/synthesisEngine";

const TEST_QUESTION = "Does __integration_test__ reduce risk?";
const TEST_HASH = questionHash(TEST_QUESTION);

const MOCK_RESULT: SynthesisResult = {
  question: TEST_QUESTION,
  questionHash: TEST_HASH,
  consensusStatus: "well-established",
  synthesisText: "Test synthesis text.",
  moderatingVariables: ["age"],
  methodologicalConcerns: ["small samples"],
  uncertaintyScore: 30,
  temporalTrend: "stable",
  supportingStudies: [],
  contradictingStudies: [],
  totalEvidence: 3,
  cached: false,
};

describe("Synthesis DB cache", () => {
  beforeEach(() => {
    _resetSynthesisMemoryCacheForTests();
  });

  afterEach(async () => {
    _resetSynthesisMemoryCacheForTests();
    await db.delete(questionSynthesisTable).where(eq(questionSynthesisTable.questionHash, TEST_HASH));
  });

  it("returns null for a question not yet cached", async () => {
    const result = await getCachedSynthesis(TEST_QUESTION);
    expect(result).toBeNull();
  });

  it("stores and retrieves a synthesis result within TTL", async () => {
    await cacheSynthesis(MOCK_RESULT);
    const retrieved = await getCachedSynthesis(TEST_QUESTION);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.cached).toBe(true);
    expect(retrieved!.synthesisText).toBe(MOCK_RESULT.synthesisText);
    expect(retrieved!.uncertaintyScore).toBe(MOCK_RESULT.uncertaintyScore);
    expect(retrieved!.consensusStatus).toBe(MOCK_RESULT.consensusStatus);
  });

  it("returns null for an expired cache entry", async () => {
    const pastDate = new Date(Date.now() - 1000);
    await db.insert(questionSynthesisTable).values({
      questionHash: TEST_HASH,
      shareId: "expired1",
      question: TEST_QUESTION,
      result: MOCK_RESULT,
      expiresAt: pastDate,
    });
    const result = await getCachedSynthesis(TEST_QUESTION);
    expect(result).toBeNull();
  });

  it("upserts on second write for the same question hash", async () => {
    await cacheSynthesis(MOCK_RESULT);
    const updated: SynthesisResult = { ...MOCK_RESULT, synthesisText: "Updated synthesis." };
    await cacheSynthesis(updated);
    const retrieved = await getCachedSynthesis(TEST_QUESTION);
    expect(retrieved!.synthesisText).toBe("Updated synthesis.");
  });

  it("assigns a stable shareId on first cache and preserves it across upserts", async () => {
    _resetSynthesisMemoryCacheForTests();
    const first: SynthesisResult = { ...MOCK_RESULT };
    await cacheSynthesis(first);
    const firstShareId = first.shareId;
    expect(firstShareId).toMatch(/^[A-Za-z0-9]{8}$/);

    _resetSynthesisMemoryCacheForTests();
    const second: SynthesisResult = { ...MOCK_RESULT, synthesisText: "Updated" };
    await cacheSynthesis(second);
    expect(second.shareId).toBe(firstShareId);

    const retrieved = await getCachedSynthesis(TEST_QUESTION);
    expect(retrieved!.shareId).toBe(firstShareId);
  });
});
