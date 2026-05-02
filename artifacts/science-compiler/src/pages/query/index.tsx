import { useState } from "react";
import { Link } from "wouter";
import {
  useQueryKnowledgeBase,
  getQueryKnowledgeBaseQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Search, ArrowRight, TrendingUp, FileText, Layers, AlertTriangle } from "lucide-react";
import { ConsensusBadge, EvidenceQualityBadge } from "@/components/badges";

function StatCard({ label, value, isLoading }: { label: string; value?: number; isLoading: boolean }) {
  return (
    <div className="text-center">
      {isLoading ? (
        <Skeleton className="h-8 w-16 mx-auto mb-1" />
      ) : (
        <div className="text-2xl font-bold text-foreground">{value?.toLocaleString() ?? 0}</div>
      )}
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

export default function QueryPage() {
  const [inputValue, setInputValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");

  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey() },
  });

  const { data: queryResult, isLoading: queryLoading, isError: queryError, error: queryErrorObj } = useQueryKnowledgeBase(
    { q: submittedQuery },
    { query: { enabled: !!submittedQuery, queryKey: getQueryKnowledgeBaseQueryKey({ q: submittedQuery }) } }
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (inputValue.trim()) setSubmittedQuery(inputValue.trim());
  }

  const exampleQueries = [
    "Does coffee reduce diabetes risk?",
    "Social media and depression in teenagers",
    "Aspirin for cardiovascular prevention",
    "Exercise and cognitive decline",
    "SSRIs effectiveness for depression",
  ];

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2" data-testid="page-title">
          Query the Knowledge Base
        </h1>
        <p className="text-muted-foreground text-lg">
          Ask any scientific question. Get a structured answer with full provenance and evidence quality.
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-6 mb-8 p-5 rounded-lg border bg-card">
        <StatCard label="Topics" value={activity?.stats.totalTopics} isLoading={activityLoading} />
        <StatCard label="Claims" value={activity?.stats.totalClaims} isLoading={activityLoading} />
        <StatCard label="Papers" value={activity?.stats.totalPapers} isLoading={activityLoading} />
        <StatCard label="Studies" value={activity?.stats.totalStudies} isLoading={activityLoading} />
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              data-testid="input-query"
              placeholder="e.g. Does coffee reduce the risk of Type 2 diabetes?"
              className="pl-10 h-12 text-base"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <Button type="submit" size="lg" className="h-12 px-6" data-testid="button-search" disabled={!inputValue.trim()}>
            Search
          </Button>
        </div>
      </form>

      {/* Example queries */}
      {!submittedQuery && (
        <div className="flex flex-wrap gap-2 mb-10">
          {exampleQueries.map((q) => (
            <button
              key={q}
              data-testid={`example-query-${q.slice(0, 20)}`}
              onClick={() => { setInputValue(q); setSubmittedQuery(q); }}
              className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary/50 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Query results */}
      {submittedQuery && (
        <div className="mb-10">
          {queryError ? (
            <div className="p-12 text-center border border-destructive/30 bg-destructive/5 rounded-lg" data-testid="error-query">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-destructive" />
              <p className="font-medium text-destructive">Query failed.</p>
              <p className="text-sm text-muted-foreground mt-1">{queryErrorObj instanceof Error ? queryErrorObj.message : "An unexpected error occurred."}</p>
            </div>
          ) : queryLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : queryResult?.noResults ? (
            <div className="p-8 rounded-lg border border-dashed text-center text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No results for "{submittedQuery}"</p>
              <p className="text-sm mt-1">Try different keywords or browse by topic.</p>
            </div>
          ) : queryResult?.matchedClaim ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3 pb-3 border-b">
                <span className="text-sm text-muted-foreground">Result for:</span>
                <span className="font-medium text-foreground">"{submittedQuery}"</span>
                <button
                  onClick={() => { setSubmittedQuery(""); setInputValue(""); }}
                  className="ml-auto text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-clear-query"
                >
                  Clear
                </button>
              </div>

              {/* Main result card */}
              <Card className="border-l-4" style={{ borderLeftColor: "hsl(var(--primary))" }}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <CardTitle className="text-xl leading-snug">{queryResult.matchedClaim.claimText}</CardTitle>
                    {queryResult.matchedClaim.synthesis && (
                      <ConsensusBadge status={queryResult.matchedClaim.synthesis.consensusStatus} />
                    )}
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                    <span>Population: <span className="text-foreground">{queryResult.matchedClaim.population}</span></span>
                    <span>Method: <span className="text-foreground">{queryResult.matchedClaim.methodologyType}</span></span>
                    <EvidenceQualityBadge quality={queryResult.matchedClaim.evidenceQuality} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {queryResult.matchedClaim.synthesis && (
                    <>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {queryResult.matchedClaim.synthesis.synthesisText}
                      </p>

                      <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-md">
                        <div className="text-center">
                          <div className="text-lg font-bold text-green-600">{queryResult.matchedClaim.synthesis.supportingCount}</div>
                          <div className="text-xs text-muted-foreground">Supporting studies</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-red-500">{queryResult.matchedClaim.synthesis.contradictingCount}</div>
                          <div className="text-xs text-muted-foreground">Contradicting studies</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-foreground">{queryResult.matchedClaim.synthesis.uncertaintyScore}%</div>
                          <div className="text-xs text-muted-foreground">Uncertainty score</div>
                        </div>
                      </div>

                      {queryResult.matchedClaim.synthesis.moderatingVariables && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key moderating variables</div>
                          <p className="text-sm text-foreground/80">{queryResult.matchedClaim.synthesis.moderatingVariables}</p>
                        </div>
                      )}

                      {queryResult.matchedClaim.synthesis.methodologicalConcerns && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Methodological concerns</div>
                          <p className="text-sm text-foreground/80">{queryResult.matchedClaim.synthesis.methodologicalConcerns}</p>
                        </div>
                      )}

                      {queryResult.matchedClaim.synthesis.temporalTrend && (
                        <div className="flex items-center gap-2 text-sm">
                          <TrendingUp className="h-4 w-4 text-primary" />
                          <span className="text-muted-foreground">Trend:</span>
                          <span>{queryResult.matchedClaim.synthesis.temporalTrend}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Link href={`/claims/${queryResult.matchedClaim.id}`}>
                      <Button variant="outline" size="sm" data-testid="button-view-claim">
                        Full claim detail <ArrowRight className="ml-2 h-3 w-3" />
                      </Button>
                    </Link>
                    <Link href={`/topics/${queryResult.matchedClaim.topicId}`}>
                      <Button variant="ghost" size="sm" data-testid="button-view-topic">
                        {queryResult.matchedClaim.topicName}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

              {/* Supporting/Contradicting studies */}
              {(queryResult.matchedClaim.supportingStudies.length > 0 || queryResult.matchedClaim.contradictingStudies.length > 0) && (
                <div className="grid md:grid-cols-2 gap-4">
                  {queryResult.matchedClaim.supportingStudies.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-green-600 mb-3">
                        Supporting Evidence ({queryResult.matchedClaim.supportingStudies.length})
                      </div>
                      <div className="space-y-2">
                        {queryResult.matchedClaim.supportingStudies.slice(0, 3).map(link => (
                          <div key={link.id} className="p-3 rounded border border-green-200/50 bg-green-50/30 dark:bg-green-900/10 dark:border-green-900/30 text-sm" data-testid={`evidence-supporting-${link.id}`}>
                            <div className="font-medium line-clamp-1">{link.study.title}</div>
                            <div className="text-muted-foreground text-xs mt-1">
                              {link.study.authors} · {link.study.publicationYear} · n={link.study.sampleSize?.toLocaleString() ?? "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {queryResult.matchedClaim.contradictingStudies.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3">
                        Contradicting Evidence ({queryResult.matchedClaim.contradictingStudies.length})
                      </div>
                      <div className="space-y-2">
                        {queryResult.matchedClaim.contradictingStudies.slice(0, 3).map(link => (
                          <div key={link.id} className="p-3 rounded border border-red-200/50 bg-red-50/30 dark:bg-red-900/10 dark:border-red-900/30 text-sm" data-testid={`evidence-contradicting-${link.id}`}>
                            <div className="font-medium line-clamp-1">{link.study.title}</div>
                            <div className="text-muted-foreground text-xs mt-1">
                              {link.study.authors} · {link.study.publicationYear} · n={link.study.sampleSize?.toLocaleString() ?? "—"}
                            </div>
                            {link.contradictionExplanation && (
                              <div className="text-xs mt-1 text-red-600/80 dark:text-red-400/80">{link.contradictionExplanation}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Related claims */}
              {queryResult.relatedClaims && queryResult.relatedClaims.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Related Claims</div>
                  <div className="grid gap-2">
                    {queryResult.relatedClaims.map(claim => (
                      <Link key={claim.id} href={`/claims/${claim.id}`} data-testid={`related-claim-${claim.id}`}>
                        <div className="flex items-center gap-3 p-3 rounded border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer">
                          <div className="flex-1 text-sm line-clamp-1">{claim.claimText}</div>
                          {claim.consensusStatus && <ConsensusBadge status={claim.consensusStatus} compact />}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Recent activity */}
      {!submittedQuery && (
        <div className="space-y-8">
          <Separator />
          <div>
            <div className="flex items-center gap-2 mb-5">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-foreground">Recent Claims</h2>
            </div>
            {activityLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {activity?.recentClaims?.map(claim => (
                  <Link key={claim.id} href={`/claims/${claim.id}`} data-testid={`recent-claim-${claim.id}`}>
                    <div className="flex items-center gap-3 p-3 rounded border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium line-clamp-1">{claim.claimText}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{claim.topicName} · {claim.methodologyType}</div>
                      </div>
                      {claim.consensusStatus && <ConsensusBadge status={claim.consensusStatus} compact />}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-5">
              <FileText className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-foreground">Recent Papers</h2>
            </div>
            {activityLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {activity?.recentPapers?.map(paper => (
                  <Link key={paper.id} href={`/papers/${paper.id}`} data-testid={`recent-paper-${paper.id}`}>
                    <div className="flex items-center gap-3 p-3 rounded border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium line-clamp-1">{paper.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{paper.authors} · {paper.journal} · {paper.publicationYear}</div>
                      </div>
                      <EvidenceQualityBadge quality={paper.evidenceQuality} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
