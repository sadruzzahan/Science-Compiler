-- NOTE: do NOT drop claims_embedding_idx — it's the HNSW vector index from
-- migration 0003. drizzle-kit emits a DROP because the index is not declared
-- in schema.ts (its `.op("vector_cosine_ops")` form breaks table inference),
-- but the index must be preserved.

-- Add share_id as nullable, backfill existing rows with cryptographically
-- random opaque ids (10 hex chars from gen_random_uuid() — ~40 bits entropy)
-- using a per-row retry loop to avoid the vanishingly small chance of
-- collision against the unique constraint, then enforce NOT NULL + UNIQUE.
-- New rows will use api-server-generated nanoids in a URL-safe customAlphabet.
ALTER TABLE "question_synthesis" ADD COLUMN "share_id" text;--> statement-breakpoint
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
BEGIN
  FOR r IN SELECT id FROM "question_synthesis" WHERE "share_id" IS NULL LOOP
    LOOP
      candidate := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "question_synthesis" WHERE "share_id" = candidate
      );
    END LOOP;
    UPDATE "question_synthesis" SET "share_id" = candidate WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "question_synthesis" ALTER COLUMN "share_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question_synthesis" ADD CONSTRAINT "question_synthesis_share_id_unique" UNIQUE("share_id");
