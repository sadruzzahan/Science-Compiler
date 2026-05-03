-- Multi-source ingestion + claim quality loop (Task #13)

-- Paper full-text + preprint columns
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "is_preprint" integer NOT NULL DEFAULT 0;
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "full_text_status" text NOT NULL DEFAULT 'unknown';
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "full_text_source" text;
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "full_text_url" text;
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "full_text" text;
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "fingerprint" text;
CREATE INDEX IF NOT EXISTS "papers_doi_idx" ON "papers" ("doi");
CREATE INDEX IF NOT EXISTS "papers_fingerprint_idx" ON "papers" ("fingerprint");

-- Claim quality columns
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "confidence" real NOT NULL DEFAULT 0.8;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'approved';
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "flag_count" integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "claims_status_idx" ON "claims" ("status");
CREATE INDEX IF NOT EXISTS "claims_confidence_idx" ON "claims" ("confidence");

-- Per-source contribution to a paper
CREATE TABLE IF NOT EXISTS "paper_sources" (
  "id" serial PRIMARY KEY,
  "paper_id" integer NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "source_id" text NOT NULL,
  "native_id" text NOT NULL,
  "url" text,
  "fetched_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "paper_sources_unique" UNIQUE ("paper_id", "source_id")
);
CREATE INDEX IF NOT EXISTS "paper_sources_native_idx" ON "paper_sources" ("source_id", "native_id");

-- Reviewer audit trail
CREATE TABLE IF NOT EXISTS "claim_reviews" (
  "id" serial PRIMARY KEY,
  "claim_id" integer NOT NULL REFERENCES "claims"("id") ON DELETE CASCADE,
  "reviewer_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decision" text NOT NULL,
  "notes" text,
  "before_json" jsonb,
  "after_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "claim_reviews_claim_idx" ON "claim_reviews" ("claim_id");

-- Per-source counts on ingestion run
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "per_source_counts" jsonb;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "papers_deduplicated" integer NOT NULL DEFAULT 0;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "full_text_fetched" integer NOT NULL DEFAULT 0;
ALTER TABLE "ingestion_runs" ADD COLUMN IF NOT EXISTS "low_confidence_claims" integer NOT NULL DEFAULT 0;

-- Source list on ingestion config (text[]; default to pubmed for backwards compat)
ALTER TABLE "ingestion_configs" ADD COLUMN IF NOT EXISTS "sources" text[] NOT NULL DEFAULT ARRAY['pubmed']::text[];

-- Backfill fingerprint for existing papers (md5 is built-in; sha1 requires pgcrypto).
UPDATE "papers" SET "fingerprint" = md5(lower(regexp_replace(coalesce(title,''),'\s+',' ','g'))||'|'||publication_year||'|'||lower(split_part(authors, ',', 1)))
WHERE "fingerprint" IS NULL;
