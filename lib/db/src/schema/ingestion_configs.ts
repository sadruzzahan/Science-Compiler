import { pgTable, text, serial, timestamp, integer, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ingestionConfigsTable = pgTable("ingestion_configs", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id").notNull(),
  pubmedQuery: text("pubmed_query").notNull(),
  maxPapersPerRun: integer("max_papers_per_run").notNull().default(10),
  enabled: integer("enabled").notNull().default(1),
  llmModel: text("llm_model").notNull().default("gpt-5-mini"),
  createdByUserId: uuid("created_by_user_id"),
  updatedByUserId: uuid("updated_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIngestionConfigSchema = createInsertSchema(ingestionConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIngestionConfig = z.infer<typeof insertIngestionConfigSchema>;
export type IngestionConfig = typeof ingestionConfigsTable.$inferSelect;
