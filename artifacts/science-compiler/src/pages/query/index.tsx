import { useState, useEffect, useRef } from "react";
import { Link, useSearch } from "wouter";
import {
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useVerifyClaim,
  getSharedSynthesis,
  type VerifyResult,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  FileText,
  Layers,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sparkles,
  ShieldCheck,
  Loader2,
  Share2,
  Check,
} from "lucide-react";
import { ConsensusBadge, EvidenceQualityBadge } from "@/components/badges";

interface StudySummary {
  claimText: string;
  direction: string;
  methodologyType: string;
  evidenceQuality: string;
  effectSize: number | null;
  effectSizeUnit: string | null;
  sampleSize: number | null;
  population: string;
  paperTitle: string;
  paperYear: number;
}

interface SynthesisResult {
  question: string;
  questionHash: string;
  shareId?: string;
  consensusStatus: string;
  synthesisText: string;
  moderatingVariables: string[];
  methodologicalConcerns: string[];
  uncertaintyScore: number;
  temporalTrend: string;
  supportingStudies: StudySummary[];
  contradictingStudies: StudySummary[];
  totalEvidence: number;
  cached: boolean;
}

type SynthesisPhase = "idle" | "streaming" | "done" | "error";

function extractPartialSynthesisText(partial: string): string {
  const full = partial.match(/"synthesisText"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (full) return full[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  const building = partial.match(/"synthesisText"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return building ? building[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : "";
}

function useSynthesis(question: string | null): {
  phase: SynthesisPhase;
  tokenBuffer: string;
  partialText: string;
  result: SynthesisResult | null;
  error: string | null;
} {
  const [phase, setPhase] = useState<SynthesisPhase>("idle");
  const [tokenBuffer, setTokenBuffer] = useState("");
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!question) {
      setPhase("idle");
      setTokenBuffer("");
      setResult(null);
      setError(null);
      doneRef.current = false;
      return;
    }

    setPhase("streaming");
    setTokenBuffer("");
    setResult(null);
    setError(null);
    doneRef.current = false;

    const controller = new AbortController();

    (async () => {
      try {
        const resp = await fetch(
          `/api/query/synthesize?q=${encodeURIComponent(question)}`,
          { signal: controller.signal, headers: { Accept: "text/event-stream" } },
        );

        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as { type: string; data: unknown };
              if (event.type === "token" && typeof event.data === "string") {
                setTokenBuffer((prev) => prev + event.data);
              } else if (event.type === "result" || event.type === "cached") {
                doneRef.current = true;
                setResult(event.data as SynthesisResult);
                setPhase("done");
              } else if (event.type === "error") {
                doneRef.current = true;
                setError(String(event.data));
                setPhase("error");
              }
            } catch {
              /* skip malformed lines */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Unknown error");
          setPhase("error");
        }
      }
    })();

    return () => controller.abort();
  }, [question]);

  const partialText = phase === "streaming" ? extractPartialSynthesisText(tokenBuffer) : "";
  return { phase, tokenBuffer, partialText, result, error };
}

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

function StudyItem({ study, kind }: { study: StudySummary; kind: "supporting" | "contradicting" }) {
  const colorClass =
    kind === "supporting"
      ? "border-green-200/60 bg-green-50/30 dark:bg-green-900/10 dark:border-green-900/30"
      : "border-red-200/60 bg-red-50/30 dark:bg-red-900/10 dark:border-red-900/30";
  return (
    <div className={`p-3 rounded border text-sm ${colorClass}`}>
      <div className="font-medium line-clamp-2 leading-snug">{study.claimText}</div>
      <div className="flex items-center gap-1.5 mt-1.5">
        <EvidenceQualityBadge quality={study.evidenceQuality} />
      </div>
      <div className="text-muted-foreground text-xs mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        <span className="capitalize">{study.methodologyType}</span>
        <span>·</span>
        <span>{study.paperTitle.length > 50 ? study.paperTitle.slice(0, 50) + "…" : study.paperTitle}</span>
        <span>·</span>
        <span>{study.paperYear}</span>
        {study.sampleSize != null && (
          <>
            <span>·</span>
            <span>n={study.sampleSize.toLocaleString()}</span>
          </>
        )}
        {study.effectSize != null && (
          <>
            <span>·</span>
            <span>{study.effectSizeUnit ?? "Effect"}: {study.effectSize.toFixed(2)}</span>
          </>
        )}
      </div>
      <div className="text-xs mt-1 text-muted-foreground/80">Pop: {study.population}</div>
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === "supported") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
  if (verdict === "contradicted") return <XCircle className="h-5 w-5 text-red-500" />;
  if (verdict === "contested") return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
}

function VerifySection() {
  const [claimInput, setClaimInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { mutate: verifyClaim, data: verifyData, isPending, reset } = useVerifyClaim();

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = claimInput.trim();
    if (!trimmed) return;
    setSubmitted(trimmed);
    verifyClaim({ data: { claim: trimmed } });
  }

  function handleClear() {
    setClaimInput("");
    setSubmitted("");
    reset();
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Verify a Specific Claim
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Enter a plain-language claim to check against the knowledge base.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleVerify} className="flex gap-2">
          <Input
            data-testid="input-verify-claim"
            placeholder='e.g. "Coffee reduces the risk of Type 2 diabetes"'
            value={claimInput}
            onChange={(e) => setClaimInput(e.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={!claimInput.trim() || isPending}
            data-testid="button-verify"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </form>

        {verifyData && submitted && (
          <div className="rounded-lg border p-4 space-y-3" data-testid="verify-result">
            <div className="flex items-center gap-3">
              <VerdictIcon verdict={verifyData.verdict} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold capitalize text-sm">{verifyData.verdict}</span>
                  <Badge variant="outline" className="text-xs">{verifyData.confidence}% confidence</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">"{submitted}"</p>
              </div>
              <button onClick={handleClear} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Clear
              </button>
            </div>

            {verifyData.matchedClaimText && (
              <div className="text-xs text-muted-foreground border-l-2 pl-3">
                <span className="font-semibold text-foreground">Best match:</span>{" "}
                {verifyData.matchedClaimText}
                {verifyData.matchedClaimId != null && (
                  <Link href={`/claims/${verifyData.matchedClaimId}`}>
                    <span className="ml-1 text-primary hover:underline cursor-pointer">View claim →</span>
                  </Link>
                )}
              </div>
            )}

            {verifyData.supportingSummary && (
              <div>
                <div className="text-xs font-semibold text-green-600 mb-1">Supporting evidence</div>
                <p className="text-sm text-foreground/80">{verifyData.supportingSummary}</p>
              </div>
            )}

            {verifyData.contradictingSummary && (
              <div>
                <div className="text-xs font-semibold text-red-500 mb-1">Contradicting evidence</div>
                <p className="text-sm text-foreground/80">{verifyData.contradictingSummary}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ShareButton({ shareId }: { shareId: string }) {
  const [copied, setCopied] = useState(false);
  async function handleShare() {
    const url = `${window.location.origin}${window.location.pathname}?synthesis=${shareId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleShare}
      data-testid="button-share-synthesis"
    >
      {copied ? (
        <><Check className="mr-2 h-3 w-3" />Link copied</>
      ) : (
        <><Share2 className="mr-2 h-3 w-3" />Share</>
      )}
    </Button>
  );
}

export default function QueryPage() {
  const search = useSearch();
  const sharedId = new URLSearchParams(search).get("synthesis");

  const [inputValue, setInputValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [sharedResult, setSharedResult] = useState<SynthesisResult | null>(null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);

  // Load shared synthesis from ?synthesis=xxx URL param.
  useEffect(() => {
    if (!sharedId) {
      setSharedResult(null);
      setSharedError(null);
      return;
    }
    setSharedLoading(true);
    setSharedError(null);
    let cancelled = false;
    (async () => {
      try {
        const data = await getSharedSynthesis(sharedId);
        if (!cancelled) {
          setSharedResult(data as SynthesisResult);
          setSubmittedQuery((data as SynthesisResult).question);
        }
      } catch {
        if (!cancelled) setSharedError("This shared synthesis could not be found or has expired.");
      } finally {
        if (!cancelled) setSharedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sharedId]);

  // Skip the auth-protected recent-activity fetch when viewing a shared link
  // so signed-out recipients don't trigger noisy 401s.
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey(), enabled: !sharedId },
  });

  // When viewing a shared synthesis, skip the streaming hook entirely.
  const liveSynthesis = useSynthesis(sharedId ? null : submittedQuery);
  const phase: SynthesisPhase = sharedId
    ? sharedLoading ? "streaming" : sharedError ? "error" : sharedResult ? "done" : "idle"
    : liveSynthesis.phase;
  const partialText = sharedId ? "" : liveSynthesis.partialText;
  const result = sharedId ? sharedResult : liveSynthesis.result;
  const error = sharedId ? sharedError : liveSynthesis.error;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = inputValue.trim();
    if (!q) return;
    // Submitting a new query supersedes any shared link.
    if (sharedId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("synthesis");
      window.history.replaceState({}, "", url.toString());
      setSharedResult(null);
    }
    setSubmittedQuery(q);
  }

  function handleClear() {
    setSubmittedQuery(null);
    setInputValue("");
    if (sharedId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("synthesis");
      window.history.replaceState({}, "", url.toString());
      setSharedResult(null);
    }
  }

  const exampleQueries = [
    "Does coffee reduce diabetes risk?",
    "Social media and depression in teenagers",
    "Aspirin for cardiovascular prevention",
    "Exercise and cognitive decline",
    "SSRIs effectiveness for depression",
  ];

  const isActive = !!submittedQuery || !!sharedId;
  const isStreaming = phase === "streaming";
  const isDone = phase === "done";
  const isError = phase === "error";

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2" data-testid="page-title">
          Query the Knowledge Base
        </h1>
        <p className="text-muted-foreground text-lg">
          Ask any scientific question. Get an AI-synthesized answer with full evidence provenance.
        </p>
      </div>

      {!sharedId && (
        <div className="grid grid-cols-4 gap-6 mb-8 p-5 rounded-lg border bg-card">
          <StatCard label="Topics" value={activity?.stats.totalTopics} isLoading={activityLoading} />
          <StatCard label="Claims" value={activity?.stats.totalClaims} isLoading={activityLoading} />
          <StatCard label="Papers" value={activity?.stats.totalPapers} isLoading={activityLoading} />
          <StatCard label="Studies" value={activity?.stats.totalStudies} isLoading={activityLoading} />
        </div>
      )}

      {sharedId && (
        <div className="mb-6 p-3 rounded-md border bg-muted/40 text-sm text-muted-foreground flex items-center justify-between" data-testid="shared-banner">
          <span>You're viewing a shared synthesis result.</span>
          <Link href="/" className="text-foreground hover:underline">Ask your own question →</Link>
        </div>
      )}

      {!sharedId && <form onSubmit={handleSubmit} className="mb-4">
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
          <Button
            type="submit"
            size="lg"
            className="h-12 px-6"
            data-testid="button-search"
            disabled={!inputValue.trim() || isStreaming}
          >
            {isStreaming ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Synthesizing</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" />Synthesize</>
            )}
          </Button>
        </div>
      </form>}

      {!isActive && (
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

      {isActive && (
        <div className="mb-10 space-y-6">
          <div className="flex items-center gap-3 pb-3 border-b">
            <span className="text-sm text-muted-foreground">
              {isStreaming ? "Synthesizing:" : "Result for:"}
            </span>
            <span className="font-medium text-foreground">"{submittedQuery}"</span>
            <button
              onClick={handleClear}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              data-testid="button-clear-query"
            >
              Clear
            </button>
          </div>

          {isError && (
            <div className="p-8 text-center border border-destructive/30 bg-destructive/5 rounded-lg" data-testid="error-synthesis">
              <AlertTriangle className="h-8 w-8 mx-auto mb-3 text-destructive" />
              <p className="font-medium text-destructive">Synthesis failed.</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
          )}

          {isStreaming && (
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-background" data-testid="synthesis-streaming">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm font-semibold text-primary">Synthesizing evidence…</span>
                </div>
              </CardHeader>
              <CardContent>
                {partialText ? (
                  <p className="text-sm leading-relaxed text-foreground/80 min-h-[3em]">
                    {partialText}
                    <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isDone && result && (
            <>
              <Card
                className="border-l-4"
                style={{ borderLeftColor: "hsl(var(--primary))" }}
                data-testid="synthesis-result"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <ConsensusBadge status={result.consensusStatus} />
                        {result.cached && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Cached
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Based on {result.totalEvidence} evidence item{result.totalEvidence !== 1 ? "s" : ""}
                      </p>
                    </div>
                    {(result.temporalTrend === "strengthening" || result.temporalTrend === "weakening") && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {result.temporalTrend === "strengthening" ? (
                          <TrendingUp className="h-4 w-4 text-green-500" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-amber-500" />
                        )}
                        <span className="capitalize">{result.temporalTrend} evidence</span>
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  <p className="text-sm leading-relaxed text-foreground/90" data-testid="synthesis-text">
                    {result.synthesisText}
                  </p>

                  <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-md">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600" data-testid="supporting-count">
                        {result.supportingStudies.length}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Supporting</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-500" data-testid="contradicting-count">
                        {result.contradictingStudies.length}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Contradicting</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-foreground" data-testid="uncertainty-score">
                        {result.uncertaintyScore}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Uncertainty</div>
                    </div>
                  </div>

                  {result.moderatingVariables.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Key moderating variables
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {result.moderatingVariables.map((v) => (
                          <li key={v} className="text-sm text-foreground/80">{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.methodologicalConcerns.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Methodological concerns
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {result.methodologicalConcerns.map((c) => (
                          <li key={c} className="text-sm text-foreground/80">{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(result.temporalTrend === "stable" || result.temporalTrend === "unclear") && (
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Temporal trend:</span>
                      <span className="capitalize">{result.temporalTrend}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <Link href={`/claims?search=${encodeURIComponent(submittedQuery ?? "")}`}>
                      <Button variant="outline" size="sm" data-testid="button-browse-claims">
                        Browse related claims <ArrowRight className="ml-2 h-3 w-3" />
                      </Button>
                    </Link>
                    {result.shareId && <ShareButton shareId={result.shareId} />}
                  </div>
                </CardContent>
              </Card>

              {(result.supportingStudies.length > 0 || result.contradictingStudies.length > 0) && (
                <div className="grid md:grid-cols-2 gap-4">
                  {result.supportingStudies.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-green-600 mb-3" data-testid="supporting-panel-header">
                        Supporting Evidence ({result.supportingStudies.length})
                      </div>
                      <div className="space-y-2">
                        {result.supportingStudies.slice(0, 5).map((s, i) => (
                          <StudyItem key={i} study={s} kind="supporting" />
                        ))}
                      </div>
                    </div>
                  )}
                  {result.contradictingStudies.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-3" data-testid="contradicting-panel-header">
                        Contradicting Evidence ({result.contradictingStudies.length})
                      </div>
                      <div className="space-y-2">
                        {result.contradictingStudies.slice(0, 5).map((s, i) => (
                          <StudyItem key={i} study={s} kind="contradicting" />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {result.totalEvidence === 0 && (
                <div className="p-8 rounded-lg border border-dashed text-center text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p className="font-medium">No matching evidence for this question</p>
                  <p className="text-sm mt-1">Try different keywords or browse by topic.</p>
                </div>
              )}

              {!sharedId && <VerifySection />}
            </>
          )}
        </div>
      )}

      {!isActive && (
        <div className="space-y-8">
          <Separator />

          <div className="mb-6">
            <VerifySection />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-5">
              <Layers className="h-4 w-4 text-primary" />
              <h2 className="font-semibold text-foreground">Recent Claims</h2>
            </div>
            {activityLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {activity?.recentClaims?.map((claim) => (
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
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2">
                {activity?.recentPapers?.map((paper) => (
                  <Link key={paper.id} href={`/papers/${paper.id}`} data-testid={`recent-paper-${paper.id}`}>
                    <div className="flex items-center gap-3 p-3 rounded border border-border hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium line-clamp-1">{paper.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {paper.authors} · {paper.journal} · {paper.publicationYear}
                        </div>
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
