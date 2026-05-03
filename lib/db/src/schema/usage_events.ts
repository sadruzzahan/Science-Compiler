import { pgTable, serial, text, integer, timestamp, numeric, uuid, index, boolean } from "drizzle-orm/pg-core";

export const usageEventsTable = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    // Nullable: system jobs (scheduler-driven ingestion) may have no user.
    userId: uuid("user_id"),
    route: text("route").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    requestId: text("request_id"),
    // True when the wrapped OpenAI call threw — lets us see error rates
    // in /admin/usage without conflating them with successful zero-cost calls.
    failed: boolean("failed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_user_created_idx").on(t.userId, t.createdAt),
    index("usage_events_created_idx").on(t.createdAt),
  ],
);

export type UsageEvent = typeof usageEventsTable.$inferSelect;
export type InsertUsageEvent = typeof usageEventsTable.$inferInsert;
