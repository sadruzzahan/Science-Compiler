import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/embeddings", () => ({
  embedText: vi.fn(),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
  isEmbeddingsAvailable: () => true,
}));

const dbResultQueue: unknown[][] = [];

vi.mock("@workspace/db", () => {
  const chain = (): Record<string, unknown> => {
    const obj: Record<string, unknown> = {
      from: vi.fn(() => obj),
      leftJoin: vi.fn(() => obj),
      where: vi.fn(() => obj),
      orderBy: vi.fn(() => obj),
      limit: vi.fn(() => Promise.resolve(dbResultQueue.shift() ?? [])),
      groupBy: vi.fn(() => obj),
      as: vi.fn(() => obj),
      select: vi.fn(() => obj),
    };
    return obj;
  };
  const db = {
    select: vi.fn(() => chain()),
    $with: vi.fn(),
  };
  return {
    db,
    claimsTable: { id: "id", claimText: "claimText", embedding: "embedding", paperId: "paperId", direction: "direction", methodologyType: "methodologyType", evidenceQuality: "evidenceQuality", population: "population", effectSize: "effectSize", effectSizeUnit: "effectSizeUnit" },
    papersTable: { id: "id", title: "title", abstract: "abstract", authors: "authors", publicationYear: "publicationYear" },
    evidenceLinksTable: {},
    studiesTable: { paperId: "paperId", sampleSize: "sampleSize" },
    claimSynthesisTable: {},
    questionSynthesisTable: {},
  };
});

import { retrieveRelevantEvidence } from "../lib/synthesisEngine";
import { embedText } from "../lib/embeddings";

const mockEmbedText = embedText as unknown as ReturnType<typeof vi.fn>;

function vectorRow(claimId: number, distance = 0.1) {
  return {
    claimId,
    claimText: `vector claim ${claimId}`,
    direction: "positive",
    methodologyType: "rct",
    evidenceQuality: "high",
    population: "adults",
    effectSize: null,
    effectSizeUnit: null,
    paperTitle: `paper ${claimId}`,
    paperAuthors: "Smith J",
    paperYear: 2024,
    sampleSize: 100,
    distance,
  };
}

function keywordRow(claimId: number) {
  return {
    claimId,
    claimText: `keyword claim ${claimId}`,
    direction: "positive",
    methodologyType: "observational",
    evidenceQuality: "moderate",
    population: "adults",
    effectSize: null,
    effectSizeUnit: null,
    paperTitle: `paper ${claimId}`,
    paperAuthors: "Doe J",
    paperYear: 2023,
    sampleSize: 50,
  };
}

describe("retrieveRelevantEvidence (hybrid)", () => {
  beforeEach(() => {
    dbResultQueue.length = 0;
    vi.clearAllMocks();
  });

  // NOTE: vector and keyword-unembedded queries now run via Promise.all.
  // retrieveByVector awaits embedText() first, so the keyword query's
  // db.select() runs synchronously *first* and consumes queue[0].

  it("merges vector hits with keyword hits for unembedded claims", async () => {
    mockEmbedText.mockResolvedValueOnce(new Array(1536).fill(0.01));
    dbResultQueue.push([keywordRow(3)]); // keyword-unembedded fires first
    dbResultQueue.push([vectorRow(1), vectorRow(2)]);

    const out = await retrieveRelevantEvidence("does coffee improve focus");
    expect(out.map((e) => e.claimId).sort()).toEqual([1, 2, 3]);
  });

  it("dedupes claims that appear in both result sets, vector wins", async () => {
    mockEmbedText.mockResolvedValueOnce(new Array(1536).fill(0.01));
    dbResultQueue.push([keywordRow(1), keywordRow(4)]);
    dbResultQueue.push([vectorRow(1)]);

    const out = await retrieveRelevantEvidence("topic question");
    const ids = out.map((e) => e.claimId);
    expect(ids).toContain(1);
    expect(ids).toContain(4);
    expect(ids.filter((i) => i === 1)).toHaveLength(1);
    const claim1 = out.find((e) => e.claimId === 1)!;
    expect(claim1.claimText).toBe("vector claim 1");
  });

  it("falls back to unrestricted keyword search when embedding generation fails", async () => {
    mockEmbedText.mockResolvedValueOnce(null);
    // Promise.all still fires both — keyword-unembedded runs synchronously,
    // then the unrestricted keyword fallback runs after vector returns null.
    dbResultQueue.push([]); // keyword-unembedded (parallel) — no result
    dbResultQueue.push([keywordRow(7), keywordRow(8)]); // full keyword fallback

    const out = await retrieveRelevantEvidence("topic question");
    expect(out.map((e) => e.claimId)).toEqual([7, 8]);
  });

  it("still returns keyword-unembedded results when vector search returns 0 in-threshold rows", async () => {
    mockEmbedText.mockResolvedValueOnce(new Array(1536).fill(0.01));
    dbResultQueue.push([keywordRow(11)]); // keyword-unembedded
    dbResultQueue.push([]); // vector returned nothing within threshold

    const out = await retrieveRelevantEvidence("rare topic");
    expect(out.map((e) => e.claimId)).toEqual([11]);
  });
});
