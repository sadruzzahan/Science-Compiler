import { pgTable, text, serial, integer, timestamp, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { claimsTable } from "./claims";
import { usersTable } from "./users";

export const claimReviewsTable = pgTable(
  "claim_reviews",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id").notNull().references(() => claimsTable.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => usersTable.id, { onDelete: "set null" }),
    // 'approve' | 'reject' | 'edit' | 'auto-approve'
    decision: text("decision").notNull(),
    notes: text("notes"),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("claim_reviews_claim_idx").on(t.claimId)],
);

export type ClaimReview = typeof claimReviewsTable.$inferSelect;
