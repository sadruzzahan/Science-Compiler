-- Task #12: observability — metrics buckets, pipeline spans, alerts.
CREATE TABLE IF NOT EXISTS "metrics_buckets" (
  "id" serial PRIMARY KEY NOT NULL,
  "bucket_start" timestamp with time zone NOT NULL,
  "route" text NOT NULL,
  "method" text NOT NULL,
  "requests" integer NOT NULL DEFAULT 0,
  "errors" integer NOT NULL DEFAULT 0,
  "p50_ms" double precision NOT NULL DEFAULT 0,
  "p95_ms" double precision NOT NULL DEFAULT 0,
  "p99_ms" double precision NOT NULL DEFAULT 0,
  "avg_ms" double precision NOT NULL DEFAULT 0,
  "max_ms" double precision NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "metrics_buckets_bucket_idx" ON "metrics_buckets" ("bucket_start");
CREATE INDEX IF NOT EXISTS "metrics_buckets_route_bucket_idx" ON "metrics_buckets" ("route","bucket_start");

CREATE TABLE IF NOT EXISTS "pipeline_spans" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" text,
  "user_id" text,
  "pipeline" text NOT NULL,
  "span_name" text NOT NULL,
  "duration_ms" double precision NOT NULL,
  "failed" integer NOT NULL DEFAULT 0,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pipeline_spans_pipeline_created_idx" ON "pipeline_spans" ("pipeline","created_at");
CREATE INDEX IF NOT EXISTS "pipeline_spans_request_idx" ON "pipeline_spans" ("request_id");

CREATE TABLE IF NOT EXISTS "alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'warning',
  "message" text NOT NULL,
  "payload" jsonb,
  "fired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "notified_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "alerts_kind_resolved_idx" ON "alerts" ("kind","resolved_at");
CREATE INDEX IF NOT EXISTS "alerts_fired_idx" ON "alerts" ("fired_at");
