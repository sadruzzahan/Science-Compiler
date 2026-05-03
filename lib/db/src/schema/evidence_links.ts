import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const evidenceLinksTable = pgTable("evidence_links", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull(),
  studyId: integer("study_id").notNull(),
  direction: text("direction").notNull(),
  contradictionExplanation: text("contradiction_explanation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("evidence_links_claim_study_idx").on(t.claimId, t.studyId),
]);

export const insertEvidenceLinkSchema = createInsertSchema(evidenceLinksTable).omit({ id: true, createdAt: true });
export type InsertEvidenceLink = z.infer<typeof insertEvidenceLinkSchema>;
export type EvidenceLink = typeof evidenceLinksTable.$inferSelect;
