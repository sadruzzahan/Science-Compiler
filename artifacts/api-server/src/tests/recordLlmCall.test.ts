import { describe, it, expect, beforeEach, vi } from "vitest";

const INSERTED: Array<Record<string, unknown>> = [];

vi.mock("@workspace/db", () => {
  const insertValues = vi.fn(async (row: Record<string, unknown>) => {
    INSERTED.push(row);
  });
  const insert = vi.fn(() => ({ values: insertValues }));
  // No-op select chain; usage.ts only uses select for read aggregates not
  // exercised in this test.
  const where = vi.fn(async () => []);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { insert, select },
    usageEventsTable: {},
  };
});

import { recordLlmCall, _resetUsageStateForTests } from "../lib/usage";

describe("recordLlmCall", () => {
  beforeEach(() => {
    INSERTED.length = 0;
    _resetUsageStateForTests();
  });

  it("inserts a usage row with computed cost on success", async () => {
    const result = await recordLlmCall(
      async () => ({ usage: { input_tokens: 1_000_000, output_tokens: 0 } }),
      { route: "test.success", model: "text-embedding-3-small", userId: "u1" },
    );
    expect(result).toBeTruthy();
    // Wait a microtask for the void-fired insert to settle.
    await new Promise((r) => setImmediate(r));
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0]).toMatchObject({
      route: "test.success",
      model: "text-embedding-3-small",
      userId: "u1",
      inputTokens: 1_000_000,
      outputTokens: 0,
      failed: false,
    });
    expect(Number(INSERTED[0].costUsd)).toBeCloseTo(0.02, 6);
  });

  it("records a failed=true row when the wrapped call throws, then re-throws", async () => {
    await expect(
      recordLlmCall(
        async () => {
          throw new Error("upstream OpenAI 500");
        },
        { route: "test.failure", model: "gpt-4o-mini", userId: "u2" },
      ),
    ).rejects.toThrow(/upstream OpenAI 500/);
    await new Promise((r) => setImmediate(r));
    expect(INSERTED).toHaveLength(1);
    expect(INSERTED[0]).toMatchObject({
      route: "test.failure",
      model: "gpt-4o-mini",
      userId: "u2",
      failed: true,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(Number(INSERTED[0].costUsd)).toBe(0);
  });
});
