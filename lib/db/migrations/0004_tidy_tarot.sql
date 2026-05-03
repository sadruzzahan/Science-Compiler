-- NOTE: do NOT drop claims_embedding_idx — it's the HNSW vector index from
-- migration 0003. drizzle-kit emits a DROP because the index is not declared
-- in schema.ts (its `.op("vector_cosine_ops")` form breaks table inference),
-- but the index must be preserved.

-- Add share_id as nullable, backfill existing rows with deterministic
-- per-row ids derived from the row's serial PK (guaranteed unique — no
-- collision risk regardless of row count), then enforce NOT NULL + UNIQUE.
-- New rows will use api-server-generated nanoids in the customAlphabet form.
ALTER TABLE "question_synthesis" ADD COLUMN "share_id" text;--> statement-breakpoint
UPDATE "question_synthesis" SET "share_id" = 'leg' || lpad(id::text, 5, '0') WHERE "share_id" IS NULL;--> statement-breakpoint
ALTER TABLE "question_synthesis" ALTER COLUMN "share_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question_synthesis" ADD CONSTRAINT "question_synthesis_share_id_unique" UNIQUE("share_id");
