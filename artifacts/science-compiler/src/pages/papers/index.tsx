import { useState } from "react";
import { Link } from "wouter";
import { useListPapers, getListPapersQueryKey, useListTopics, getListTopicsQueryKey } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, ExternalLink } from "lucide-react";
import { EvidenceQualityBadge, ReplicationBadge } from "@/components/badges";

const METHODOLOGY_TYPES = ["meta-analysis", "rct", "observational", "cohort", "case-control", "cross-sectional", "review"];
const QUALITY_GRADES = ["A", "B", "C", "D"];
const REPLICATION_STATUSES = ["confirmed", "unverified", "failed", "partial"];

export default function PapersPage() {
  const [search, setSearch] = useState("");
  const [methodologyType, setMethodologyType] = useState<string | undefined>(undefined);
  const [evidenceQuality, setEvidenceQuality] = useState<string | undefined>(undefined);
  const [replicationStatus, setReplicationStatus] = useState<string | undefined>(undefined);
  const [domain, setDomain] = useState<string | undefined>(undefined);

  const params = {
    search: search || undefined,
    methodologyType: methodologyType || undefined,
    evidenceQuality: evidenceQuality || undefined,
    replicationStatus: replicationStatus || undefined,
    domain: domain || undefined,
    limit: 30,
  };

  const { data, isLoading, isError, error } = useListPapers(params, {
    query: { queryKey: getListPapersQueryKey(params) },
  });

  const { data: topics } = useListTopics({ query: { queryKey: getListTopicsQueryKey() } });
  const topicMap = Object.fromEntries((topics ?? []).map(t => [t.id, t.name]));
  const domains = Array.from(new Set((topics ?? []).map(t => t.domain))).sort();

  function clearFilters() {
    setSearch("");
    setMethodologyType(undefined);
    setEvidenceQuality(undefined);
    setReplicationStatus(undefined);
    setDomain(undefined);
  }

  const hasFilters = !!search || !!methodologyType || !!evidenceQuality || !!replicationStatus || !!domain;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="page-title">Papers</h1>
        <p className="text-muted-foreground mt-2">Browse the scientific papers indexed in the knowledge base.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search-papers"
            placeholder="Search by title..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={methodologyType ?? "all"} onValueChange={(v) => setMethodologyType(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-44" data-testid="select-methodology">
            <SelectValue placeholder="Methodology" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All methodologies</SelectItem>
            {METHODOLOGY_TYPES.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={evidenceQuality ?? "all"} onValueChange={(v) => setEvidenceQuality(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-36" data-testid="select-quality">
            <SelectValue placeholder="Quality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grades</SelectItem>
            {QUALITY_GRADES.map(g => (
              <SelectItem key={g} value={g}>Grade {g}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={replicationStatus ?? "all"} onValueChange={(v) => setReplicationStatus(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-40" data-testid="select-replication">
            <SelectValue placeholder="Replication" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {REPLICATION_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={domain ?? "all"} onValueChange={(v) => setDomain(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-44" data-testid="select-domain">
            <SelectValue placeholder="Domain" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All domains</SelectItem>
            {domains.map(d => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <button onClick={clearFilters} className="text-sm text-muted-foreground hover:text-foreground transition-colors" data-testid="button-clear-filters">
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      {!isLoading && data && (
        <div className="text-sm text-muted-foreground mb-4">
          {data.total} paper{data.total !== 1 ? "s" : ""} found
        </div>
      )}

      {/* Papers list */}
      {isError ? (
        <div className="p-12 text-center border border-destructive/30 bg-destructive/5 rounded-lg" data-testid="error-papers">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-destructive" />
          <p className="font-medium text-destructive">Could not load papers.</p>
          <p className="text-sm text-muted-foreground mt-1">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : data?.papers.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>No papers match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data?.papers.map(paper => (
            <Link key={paper.id} href={`/papers/${paper.id}`} data-testid={`paper-card-${paper.id}`}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-base leading-snug mb-1">{paper.title}</div>
                      <div className="text-sm text-muted-foreground mb-2">
                        {paper.authors} · <em>{paper.journal}</em> · {paper.publicationYear}
                        {paper.topicId && topicMap[paper.topicId] && (
                          <span> · <span className="text-primary/80">{topicMap[paper.topicId]}</span></span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <Badge variant="outline" className="text-xs capitalize">{paper.methodologyType}</Badge>
                        {paper.sampleSize && (
                          <span className="text-xs text-muted-foreground">n={paper.sampleSize.toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <EvidenceQualityBadge quality={paper.evidenceQuality} />
                      <ReplicationBadge status={paper.replicationStatus} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
