import { pgTable, text, serial, timestamp, integer, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const ingestionRunsTable = pgTable("ingestion_runs", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id"),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("scheduler"),
  papersFound: integer("papers_found").notNull().default(0),
  papersProcessed: integer("papers_processed").notNull().default(0),
  papersDeduplicated: integer("papers_deduplicated").notNull().default(0),
  fullTextFetched: integer("full_text_fetched").notNull().default(0),
  lowConfidenceClaims: integer("low_confidence_claims").notNull().default(0),
  claimsExtracted: integer("claims_extracted").notNull().default(0),
  errorsCount: integer("errors_count").notNull().default(0),
  errorDetails: text("error_details"),
  perSourceCounts: jsonb("per_source_counts"),
  createdByUserId: uuid("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIngestionRunSchema = createInsertSchema(ingestionRunsTable).omit({ id: true, createdAt: true });
export type InsertIngestionRun = z.infer<typeof insertIngestionRunSchema>;
export type IngestionRun = typeof ingestionRunsTable.$inferSelect;
