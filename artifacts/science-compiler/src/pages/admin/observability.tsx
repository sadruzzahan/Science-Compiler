import { useGetObservability, getGetObservabilityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, RefreshCw, Activity, DollarSign, Zap } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function severityBadge(s: string) {
  if (s === "critical") return <Badge variant="destructive">{s}</Badge>;
  if (s === "warning") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">{s}</Badge>;
  return <Badge variant="secondary">{s}</Badge>;
}

export default function AdminObservabilityPage() {
  const { data, isLoading, refetch, isFetching } = useGetObservability({
    query: { queryKey: getGetObservabilityQueryKey(), refetchInterval: 30_000 },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-muted-foreground">No data available.</div>;
  }

  const totalRequests = data.timeseries.reduce((s, p) => s + p.requests, 0);
  const totalErrors = data.timeseries.reduce((s, p) => s + p.errors, 0);
  const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return (
    <div className="p-6 space-y-6" data-testid="admin-observability">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Observability</h1>
          <p className="text-sm text-muted-foreground">
            Live metrics, alerts, and pipeline timing. Auto-refreshes every 30s.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data.alerts.active.length > 0 && (
        <Card className="border-destructive" data-testid="active-alerts">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Active Alerts ({data.alerts.active.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.active.map((a) => (
              <div key={a.id} className="flex items-center justify-between border rounded p-3">
                <div>
                  <div className="font-medium">{a.message}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.kind} · fired {new Date(a.firedAt).toLocaleString()}
                  </div>
                </div>
                {severityBadge(a.severity)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4" /> Requests / hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRequests.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">last 60 min</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Error rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${overallErrorRate > 5 ? "text-destructive" : ""}`}>
              {overallErrorRate.toFixed(2)}%
            </div>
            <div className="text-xs text-muted-foreground">{totalErrors} / {totalRequests}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> LLM spend today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${data.llmCost.todayUsd.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">
              of ${data.llmCost.dailyCapUsd.toFixed(2)} cap
              {data.llmCost.dailyCapUsd > 0 && ` (${(data.llmCost.utilization * 100).toFixed(0)}%)`}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" /> Active SSE
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.sse.active}</div>
            <div className="text-xs text-muted-foreground">streams open now</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Requests per minute</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.timeseries.map((p) => ({ ...p, time: fmtTime(p.ts) }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="requests" stroke="#2563eb" name="Requests" />
              <Line type="monotone" dataKey="errors" stroke="#dc2626" name="Errors" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>p95 latency (ms)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.timeseries.map((p) => ({ ...p, time: fmtTime(p.ts) }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="p95Ms" stroke="#7c3aed" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>LLM cost (last 7 days)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.llmCost.sevenDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Bar dataKey="costUsd" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Top routes (last hour)</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-72">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-2">Route</th>
                  <th className="text-right p-2">Reqs</th>
                  <th className="text-right p-2">Errors</th>
                  <th className="text-right p-2">Err %</th>
                  <th className="text-right p-2">p50</th>
                  <th className="text-right p-2">p95</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.slice(0, 30).map((r) => (
                  <tr key={r.route} className="border-b">
                    <td className="p-2 font-mono text-xs">{r.route}</td>
                    <td className="p-2 text-right">{r.requests}</td>
                    <td className="p-2 text-right">{r.errors}</td>
                    <td className={`p-2 text-right ${r.errorRate > 0.05 ? "text-destructive font-medium" : ""}`}>
                      {(r.errorRate * 100).toFixed(1)}%
                    </td>
                    <td className="p-2 text-right">{r.p50Ms.toFixed(0)}ms</td>
                    <td className="p-2 text-right">{r.p95Ms.toFixed(0)}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Pipeline timing (last hour)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left p-2">Pipeline</th>
                    <th className="text-left p-2">Span</th>
                    <th className="text-right p-2">Count</th>
                    <th className="text-right p-2">Avg</th>
                    <th className="text-right p-2">p95</th>
                    <th className="text-right p-2">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pipeline.map((s, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2">{s.pipeline}</td>
                      <td className="p-2 font-mono text-xs">{s.spanName}</td>
                      <td className="p-2 text-right">{s.count}</td>
                      <td className="p-2 text-right">{s.avgMs.toFixed(0)}ms</td>
                      <td className="p-2 text-right">{s.p95Ms.toFixed(0)}ms</td>
                      <td className="p-2 text-right">{s.failed}</td>
                    </tr>
                  ))}
                  {data.pipeline.length === 0 && (
                    <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No pipeline activity yet.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Top failing requestIds</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left p-2">Request ID</th>
                    <th className="text-left p-2">Route</th>
                    <th className="text-right p-2">Failures</th>
                  </tr>
                </thead>
                <tbody>
                  {data.failingRequestIds.map((r, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-2 font-mono text-xs">{r.requestId ?? "—"}</td>
                      <td className="p-2 text-xs">{r.route ?? "—"}</td>
                      <td className="p-2 text-right">{r.count}</td>
                    </tr>
                  ))}
                  {data.failingRequestIds.length === 0 && (
                    <tr><td colSpan={3} className="p-4 text-center text-muted-foreground">No failing requests in the last hour 🎉</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {data.alerts.recent.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Recent alerts</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {data.alerts.recent.map((a) => (
                  <div key={a.id} className="flex items-center justify-between border rounded p-2 text-sm">
                    <div>
                      <div>{a.message}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.kind} · {new Date(a.firedAt).toLocaleString()}
                        {a.resolvedAt && ` · resolved ${new Date(a.resolvedAt).toLocaleString()}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {severityBadge(a.severity)}
                      {a.resolvedAt
                        ? <Badge variant="outline">resolved</Badge>
                        : <Badge variant="destructive">active</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
