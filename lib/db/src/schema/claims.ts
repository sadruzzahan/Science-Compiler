import { pgTable, text, serial, timestamp, integer, real, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Note: the HNSW cosine index on `embedding` (`claims_embedding_idx`) is
// created by migration 0003. We intentionally do not declare it in schema
// because the operator-class form trips drizzle's type inference for the
// whole table; the index lives in the database regardless.
export const claimsTable = pgTable("claims", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id").notNull(),
  paperId: integer("paper_id").notNull(),
  claimText: text("claim_text").notNull(),
  direction: text("direction").notNull(),
  effectSize: real("effect_size"),
  effectSizeUnit: text("effect_size_unit"),
  ciLower: real("ci_lower"),
  ciUpper: real("ci_upper"),
  population: text("population").notNull(),
  conditions: text("conditions"),
  methodologyType: text("methodology_type").notNull(),
  evidenceQuality: text("evidence_quality").notNull(),
  replicationStatus: text("replication_status").notNull().default("unverified"),
  nReplications: integer("n_replications").notNull().default(0),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClaimSchema = createInsertSchema(claimsTable).omit({ id: true, createdAt: true, updatedAt: true, embedding: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claimsTable.$inferSelect;
