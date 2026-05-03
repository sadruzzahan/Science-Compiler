-- Task #11: per-user/IP rate limits, daily quotas, and global LLM cost cap.
-- usage_events records every billable LLM call so we can enforce per-user
-- daily quotas and a global daily USD spend ceiling.
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" serial PRIMARY KEY,
  "user_id" uuid,
  "route" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "cost_usd" numeric(12, 6) NOT NULL DEFAULT 0,
  "request_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_user_created_idx"
  ON "usage_events" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_created_idx"
  ON "usage_events" ("created_at");
