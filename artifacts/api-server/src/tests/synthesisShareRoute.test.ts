import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { db, questionSynthesisTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../app";
import {
  cacheSynthesis,
  questionHash,
  _resetSynthesisMemoryCacheForTests,
  type SynthesisResult,
} from "../lib/synthesisEngine";

const TEST_QUESTION = "Does __share_route_test__ help focus?";
const TEST_HASH = questionHash(TEST_QUESTION);

const MOCK: SynthesisResult = {
  question: TEST_QUESTION,
  questionHash: TEST_HASH,
  consensusStatus: "well-established",
  synthesisText: "Route test synthesis.",
  moderatingVariables: [],
  methodologicalConcerns: [],
  uncertaintyScore: 10,
  temporalTrend: "stable",
  supportingStudies: [],
  contradictingStudies: [],
  totalEvidence: 1,
  cached: false,
};

describe("GET /api/synthesis/:shareId", () => {
  afterAll(async () => {
    _resetSynthesisMemoryCacheForTests();
    await db.delete(questionSynthesisTable).where(eq(questionSynthesisTable.questionHash, TEST_HASH));
  });

  it("returns 400 for an invalid share id shape", async () => {
    const res = await request(app).get("/api/synthesis/!!!bad!!!");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid share id" });
  });

  it("returns 404 for an unknown share id", async () => {
    const res = await request(app).get("/api/synthesis/zzz999unknown");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Synthesis not found" });
  });

  it("returns 200 with the stored synthesis for a valid share id (no auth)", async () => {
    _resetSynthesisMemoryCacheForTests();
    const seed: SynthesisResult = { ...MOCK };
    await cacheSynthesis(seed);
    const id = seed.shareId!;
    expect(id).toMatch(/^[A-Za-z0-9]{8}$/);

    const res = await request(app).get(`/api/synthesis/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.question).toBe(TEST_QUESTION);
    expect(res.body.shareId).toBe(id);
    expect(res.body.cached).toBe(true);
  });
});
