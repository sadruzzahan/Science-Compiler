import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";

export const questionSynthesisTable = pgTable("question_synthesis", {
  id: serial("id").primaryKey(),
  questionHash: text("question_hash").notNull().unique(),
  question: text("question").notNull(),
  result: jsonb("result").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QuestionSynthesis = typeof questionSynthesisTable.$inferSelect;
