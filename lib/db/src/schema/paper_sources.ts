import { pgTable, text, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { papersTable } from "./papers";

export const paperSourcesTable = pgTable(
  "paper_sources",
  {
    id: serial("id").primaryKey(),
    paperId: integer("paper_id").notNull().references(() => papersTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    nativeId: text("native_id").notNull(),
    url: text("url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("paper_sources_unique").on(t.paperId, t.sourceId),
    index("paper_sources_native_idx").on(t.sourceId, t.nativeId),
  ],
);

export type PaperSource = typeof paperSourcesTable.$inferSelect;
