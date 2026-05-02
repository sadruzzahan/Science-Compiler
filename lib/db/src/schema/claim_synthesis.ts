import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const claimSynthesisTable = pgTable("claim_synthesis", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().unique(),
  topicId: integer("topic_id").notNull(),
  consensusStatus: text("consensus_status").notNull(),
  synthesisText: text("synthesis_text").notNull(),
  supportingCount: integer("supporting_count").notNull().default(0),
  contradictingCount: integer("contradicting_count").notNull().default(0),
  weightedEffectSize: real("weighted_effect_size"),
  uncertaintyScore: integer("uncertainty_score").notNull().default(50),
  moderatingVariables: text("moderating_variables"),
  methodologicalConcerns: text("methodological_concerns"),
  temporalTrend: text("temporal_trend"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClaimSynthesisSchema = createInsertSchema(claimSynthesisTable).omit({ id: true, createdAt: true });
export type InsertClaimSynthesis = z.infer<typeof insertClaimSynthesisSchema>;
export type ClaimSynthesis = typeof claimSynthesisTable.$inferSelect;
