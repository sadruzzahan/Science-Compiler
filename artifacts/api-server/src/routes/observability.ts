import { Router, type IRouter } from "express";
import { db, metricsBucketsTable, pipelineSpansTable, usageEventsTable, alertsTable } from "@workspace/db";
import { gte, sql, desc, isNull } from "drizzle-orm";
import { activeSseCount, getInMemoryBuckets } from "../lib/metrics";
import { getBudgetStatus } from "../lib/usage";
import { listRecentAlerts } from "../lib/alerts";

const router: IRouter = Router();

router.get("/admin/observability", async (_req, res): Promise<void> => {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60_000);
  const sixtyMinAgo = new Date(now - 60 * 60_000);
  const sevenDayAgo = new Date(now - 7 * 24 * 60 * 60_000);
  const todayStart = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ));

  // Use both freshly-aggregated DB buckets AND in-memory current bucket so
  // the dashboard reflects the last few seconds without waiting for flush.
  const dbBuckets = await db
    .select()
    .from(metricsBucketsTable)
    .where(gte(metricsBucketsTable.bucketStart, sixtyMinAgo))
    .orderBy(metricsBucketsTable.bucketStart);

  const memBuckets = getInMemoryBuckets()
    .filter((b) => b.bucketStart >= sixtyMinAgo.getTime())
    .map((b) => ({
      id: -1,
      bucketStart: new Date(b.bucketStart),
      route: b.route,
      method: b.method,
      requests: b.requests,
      errors: b.errors,
      p50Ms: b.p50Ms,
      p95Ms: b.p95Ms,
      p99Ms: b.p99Ms,
      avgMs: b.avgMs,
      maxMs: b.maxMs,
      createdAt: new Date(),
    }));

  // Dedupe by (bucketStart, method, route): in-memory entries take precedence
  // over DB rows for the same minute since they have the freshest counts and
  // the flusher may have already written that bucket.
  const bucketMap = new Map<string, typeof dbBuckets[number]>();
  for (const b of dbBuckets) {
    bucketMap.set(`${b.bucketStart.getTime()}|${b.method}|${b.route}`, b);
  }
  for (const b of memBuckets) {
    bucketMap.set(`${b.bucketStart.getTime()}|${b.method}|${b.route}`, b);
  }
  const buckets = Array.from(bucketMap.values());

  // Per-minute aggregate across all routes for the timeseries chart.
  const perMinute = new Map<number, { requests: number; errors: number; latencies: number[] }>();
  for (const b of buckets) {
    const key = b.bucketStart.getTime();
    let agg = perMinute.get(key);
    if (!agg) { agg = { requests: 0, errors: 0, latencies: [] }; perMinute.set(key, agg); }
    agg.requests += b.requests;
    agg.errors += b.errors;
    if (b.p95Ms > 0) agg.latencies.push(b.p95Ms);
  }
  const timeseries = Array.from(perMinute.entries())
    .sort(([a], [c]) => a - c)
    .map(([ts, agg]) => ({
      ts: new Date(ts).toISOString(),
      requests: agg.requests,
      errors: agg.errors,
      errorRate: agg.requests > 0 ? agg.errors / agg.requests : 0,
      p95Ms: agg.latencies.length ? agg.latencies.reduce((s, v) => s + v, 0) / agg.latencies.length : 0,
    }));

  // Per-route summary for the last hour.
  const perRoute = new Map<string, { requests: number; errors: number; p50: number[]; p95: number[] }>();
  for (const b of buckets) {
    const key = `${b.method} ${b.route}`;
    let agg = perRoute.get(key);
    if (!agg) { agg = { requests: 0, errors: 0, p50: [], p95: [] }; perRoute.set(key, agg); }
    agg.requests += b.requests;
    agg.errors += b.errors;
    if (b.p50Ms > 0) agg.p50.push(b.p50Ms);
    if (b.p95Ms > 0) agg.p95.push(b.p95Ms);
  }
  const routes = Array.from(perRoute.entries()).map(([k, agg]) => ({
    route: k,
    requests: agg.requests,
    errors: agg.errors,
    errorRate: agg.requests > 0 ? agg.errors / agg.requests : 0,
    p50Ms: agg.p50.length ? agg.p50.reduce((s, v) => s + v, 0) / agg.p50.length : 0,
    p95Ms: agg.p95.length ? agg.p95.reduce((s, v) => s + v, 0) / agg.p95.length : 0,
  })).sort((a, b) => b.requests - a.requests);

  const llmCostToday = await db
    .select({ cost: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text` })
    .from(usageEventsTable)
    .where(gte(usageEventsTable.createdAt, todayStart));

  const llmCostByDay = await db
    .select({
      day: sql<string>`date_trunc('day', ${usageEventsTable.createdAt})::date::text`,
      cost: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text`,
    })
    .from(usageEventsTable)
    .where(gte(usageEventsTable.createdAt, sevenDayAgo))
    .groupBy(sql`date_trunc('day', ${usageEventsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${usageEventsTable.createdAt})`);

  const failingRequestIds = await db
    .select({
      requestId: usageEventsTable.requestId,
      count: sql<number>`COUNT(*)::int`,
      totalCost: sql<string>`COALESCE(SUM(${usageEventsTable.costUsd}), 0)::text`,
      route: sql<string>`MAX(${usageEventsTable.route})`,
    })
    .from(usageEventsTable)
    .where(sql`${usageEventsTable.failed} = true AND ${usageEventsTable.createdAt} >= ${oneHourAgo} AND ${usageEventsTable.requestId} IS NOT NULL`)
    .groupBy(usageEventsTable.requestId)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(10);

  const recentSpans = await db
    .select({
      pipeline: pipelineSpansTable.pipeline,
      spanName: pipelineSpansTable.spanName,
      avgMs: sql<number>`AVG(${pipelineSpansTable.durationMs})::float`,
      p95Ms: sql<number>`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ${pipelineSpansTable.durationMs})::float`,
      count: sql<number>`COUNT(*)::int`,
      failed: sql<number>`SUM(${pipelineSpansTable.failed})::int`,
    })
    .from(pipelineSpansTable)
    .where(gte(pipelineSpansTable.createdAt, oneHourAgo))
    .groupBy(pipelineSpansTable.pipeline, pipelineSpansTable.spanName)
    .orderBy(pipelineSpansTable.pipeline, pipelineSpansTable.spanName);

  const activeAlerts = await db
    .select()
    .from(alertsTable)
    .where(isNull(alertsTable.resolvedAt))
    .orderBy(desc(alertsTable.firedAt))
    .limit(20);

  const recentAlerts = await listRecentAlerts(20);

  const budget = await getBudgetStatus();

  res.json({
    timeseries,
    routes,
    llmCost: {
      todayUsd: parseFloat(llmCostToday[0]?.cost ?? "0"),
      dailyCapUsd: budget.capUsd ?? 0,
      utilization: (budget.capUsd ?? 0) > 0
        ? parseFloat(llmCostToday[0]?.cost ?? "0") / (budget.capUsd ?? 1)
        : 0,
      sevenDay: llmCostByDay.map((r) => ({ day: r.day, costUsd: parseFloat(r.cost) })),
    },
    failingRequestIds: failingRequestIds.map((r) => ({
      requestId: r.requestId,
      count: r.count,
      route: r.route,
      totalCostUsd: parseFloat(r.totalCost),
    })),
    pipeline: recentSpans,
    sse: { active: activeSseCount() },
    alerts: { active: activeAlerts, recent: recentAlerts },
    generatedAt: new Date(now).toISOString(),
  });
});

export default router;
