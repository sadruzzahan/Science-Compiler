CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
CREATE INDEX "claims_embedding_idx" ON "claims" USING hnsw ("embedding" vector_cosine_ops);
