import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const papersTable = pgTable("papers", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id").notNull(),
  title: text("title").notNull(),
  authors: text("authors").notNull(),
  journal: text("journal").notNull(),
  publicationYear: integer("publication_year").notNull(),
  doi: text("doi"),
  pmid: text("pmid"),
  abstract: text("abstract").notNull(),
  methodologyType: text("methodology_type").notNull(),
  sampleSize: integer("sample_size"),
  pValue: text("p_value"),
  evidenceQuality: text("evidence_quality").notNull(),
  replicationStatus: text("replication_status").notNull().default("unverified"),
  openAccessUrl: text("open_access_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPaperSchema = createInsertSchema(papersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaper = z.infer<typeof insertPaperSchema>;
export type Paper = typeof papersTable.$inferSelect;
