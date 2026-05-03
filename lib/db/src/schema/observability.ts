import { pgTable, serial, text, integer, timestamp, jsonb, doublePrecision, index } from "drizzle-orm/pg-core";

export const metricsBucketsTable = pgTable(
  "metrics_buckets",
  {
    id: serial("id").primaryKey(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    route: text("route").notNull(),
    method: text("method").notNull(),
    requests: integer("requests").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    p50Ms: doublePrecision("p50_ms").notNull().default(0),
    p95Ms: doublePrecision("p95_ms").notNull().default(0),
    p99Ms: doublePrecision("p99_ms").notNull().default(0),
    avgMs: doublePrecision("avg_ms").notNull().default(0),
    maxMs: doublePrecision("max_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("metrics_buckets_bucket_idx").on(t.bucketStart),
    index("metrics_buckets_route_bucket_idx").on(t.route, t.bucketStart),
  ],
);

export const pipelineSpansTable = pgTable(
  "pipeline_spans",
  {
    id: serial("id").primaryKey(),
    requestId: text("request_id"),
    userId: text("user_id"),
    pipeline: text("pipeline").notNull(),
    spanName: text("span_name").notNull(),
    durationMs: doublePrecision("duration_ms").notNull(),
    failed: integer("failed").notNull().default(0),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pipeline_spans_pipeline_created_idx").on(t.pipeline, t.createdAt),
    index("pipeline_spans_request_idx").on(t.requestId),
  ],
);

export const alertsTable = pgTable(
  "alerts",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull().default("warning"),
    message: text("message").notNull(),
    payload: jsonb("payload"),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("alerts_kind_resolved_idx").on(t.kind, t.resolvedAt),
    index("alerts_fired_idx").on(t.firedAt),
  ],
);

export type MetricsBucket = typeof metricsBucketsTable.$inferSelect;
export type PipelineSpan = typeof pipelineSpansTable.$inferSelect;
export type Alert = typeof alertsTable.$inferSelect;
