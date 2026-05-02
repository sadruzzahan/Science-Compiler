import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studiesTable = pgTable("studies", {
  id: serial("id").primaryKey(),
  paperId: integer("paper_id").notNull(),
  topicId: integer("topic_id").notNull(),
  title: text("title").notNull(),
  authors: text("authors").notNull(),
  publicationYear: integer("publication_year").notNull(),
  methodologyType: text("methodology_type").notNull(),
  sampleSize: integer("sample_size"),
  effectSize: real("effect_size"),
  effectSizeUnit: text("effect_size_unit"),
  ciLower: real("ci_lower"),
  ciUpper: real("ci_upper"),
  pValue: text("p_value"),
  evidenceQuality: text("evidence_quality").notNull(),
  population: text("population").notNull(),
  preregistered: integer("preregistered").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStudySchema = createInsertSchema(studiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type Study = typeof studiesTable.$inferSelect;
