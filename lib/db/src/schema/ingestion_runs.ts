import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ingestionRunsTable = pgTable("ingestion_runs", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id"),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("scheduler"),
  papersFound: integer("papers_found").notNull().default(0),
  papersProcessed: integer("papers_processed").notNull().default(0),
  claimsExtracted: integer("claims_extracted").notNull().default(0),
  errorsCount: integer("errors_count").notNull().default(0),
  errorDetails: text("error_details"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIngestionRunSchema = createInsertSchema(ingestionRunsTable).omit({ id: true, createdAt: true });
export type InsertIngestionRun = z.infer<typeof insertIngestionRunSchema>;
export type IngestionRun = typeof ingestionRunsTable.$inferSelect;
