import { Link } from "wouter";
import { useGetClaim, getGetClaimQueryKey } from "@workspace/api-client-react";
import type { EvidenceLinkWithStudy } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, TrendingUp, FileText } from "lucide-react";
import { ConsensusBadge, EvidenceQualityBadge, ReplicationBadge } from "@/components/badges";

function StudyCard({ link, kind }: { link: EvidenceLinkWithStudy; kind: "supporting" | "contradicting" }) {
  const colorClass = kind === "supporting"
    ? "border-l-green-500 bg-green-50/30 dark:bg-green-900/5"
    : "border-l-red-500 bg-red-50/30 dark:bg-red-900/5";
  return (
    <Card className={`border-l-4 ${colorClass}`} data-testid={`study-${kind}-${link.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-sm font-semibold leading-snug">{link.study.title}</p>
          <EvidenceQualityBadge quality={link.study.evidenceQuality} />
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          {link.study.authors} · {link.study.publicationYear} · <span className="capitalize">{link.study.methodologyType}</span>
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {link.study.sampleSize && <Badge variant="outline" className="text-xs">n={link.study.sampleSize.toLocaleString()}</Badge>}
          {link.study.effectSize != null && (
            <Badge variant="outline" className="text-xs">
              {link.study.effectSizeUnit ?? "Effect"}: {link.study.effectSize.toFixed(2)}
              {link.study.ciLower != null && link.study.ciUpper != null && ` (${link.study.ciLower.toFixed(2)}–${link.study.ciUpper.toFixed(2)})`}
            </Badge>
          )}
          {link.study.pValue && <Badge variant="outline" className="text-xs">p={link.study.pValue}</Badge>}
          {link.study.preregistered === 1 && <Badge variant="outline" className="text-xs bg-primary/10">Preregistered</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Population: {link.study.population}</p>
        {link.contradictionExplanation && (
          <p className="text-xs mt-2 pt-2 border-t border-border italic text-foreground/70">
            <span className="font-semibold not-italic">Why it disagrees:</span> {link.contradictionExplanation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClaimDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { data: claim, isLoading, isError } = useGetClaim(id, {
    query: { enabled: !!id, queryKey: getGetClaimQueryKey(id) },
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !claim) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-muted-foreground">
        <p>Claim not found.</p>
        <Link href="/claims"><Button variant="outline" className="mt-4">Back to Claims</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/claims">
        <Button variant="ghost" size="sm" className="mb-6 -ml-2" data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" /> Claims
        </Button>
      </Link>

      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-2xl font-bold leading-snug text-foreground" data-testid="claim-title">{claim.claimText}</h1>
          {claim.synthesis && <ConsensusBadge status={claim.synthesis.consensusStatus} />}
        </div>
        <div className="flex flex-wrap gap-2 items-center text-sm text-muted-foreground mb-4">
          <Link href={`/topics/${claim.topicId}`}>
            <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/70" data-testid="badge-topic">{claim.topicName}</Badge>
          </Link>
          <Badge variant="outline" className="capitalize">{claim.direction}</Badge>
          <Badge variant="outline" className="capitalize">{claim.methodologyType}</Badge>
          <EvidenceQualityBadge quality={claim.evidenceQuality} />
          <ReplicationBadge status={claim.replicationStatus} />
        </div>

        {/* Effect size summary */}
        {claim.effectSize != null && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/40 rounded-md mb-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Effect</div>
              <div className="font-mono font-semibold mt-1">{claim.effectSize.toFixed(2)} {claim.effectSizeUnit && <span className="text-xs text-muted-foreground">{claim.effectSizeUnit}</span>}</div>
            </div>
            {claim.ciLower != null && claim.ciUpper != null && (
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider">95% CI</div>
                <div className="font-mono font-semibold mt-1 text-sm">{claim.ciLower.toFixed(2)} – {claim.ciUpper.toFixed(2)}</div>
              </div>
            )}
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Population</div>
              <div className="text-sm mt-1">{claim.population}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Replications</div>
              <div className="font-mono font-semibold mt-1">{claim.nReplications}</div>
            </div>
          </div>
        )}

        {claim.conditions && (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Conditions:</span> {claim.conditions}
          </p>
        )}

        <div className="text-sm text-muted-foreground mt-3 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          From paper: <Link href={`/papers/${claim.paperId}`}><span className="text-primary hover:underline cursor-pointer" data-testid="link-source-paper">{claim.paperTitle}</span></Link>
        </div>
      </div>

      {/* Synthesis */}
      {claim.synthesis && (
        <Card className="mb-8 border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Synthesis</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-relaxed text-foreground/90" data-testid="synthesis-text">{claim.synthesis.synthesisText}</p>

            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-md">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600" data-testid="synthesis-supporting-count">{claim.synthesis.supportingCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Supporting</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500" data-testid="synthesis-contradicting-count">{claim.synthesis.contradictingCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Contradicting</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-foreground" data-testid="synthesis-uncertainty">{claim.synthesis.uncertaintyScore}%</div>
                <div className="text-xs text-muted-foreground mt-1">Uncertainty</div>
              </div>
            </div>

            {claim.synthesis.moderatingVariables && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key Moderating Variables</div>
                <p className="text-sm text-foreground/80">{claim.synthesis.moderatingVariables}</p>
              </div>
            )}
            {claim.synthesis.methodologicalConcerns && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Methodological Concerns</div>
                <p className="text-sm text-foreground/80">{claim.synthesis.methodologicalConcerns}</p>
              </div>
            )}
            {claim.synthesis.temporalTrend && (
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Trend over time:</span>
                <span>{claim.synthesis.temporalTrend}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Studies */}
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-green-600 mb-4">
            Supporting Studies ({claim.supportingStudies.length})
          </h2>
          {claim.supportingStudies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No supporting studies indexed.</p>
          ) : (
            <div className="space-y-3">
              {claim.supportingStudies.map(link => <StudyCard key={link.id} link={link} kind="supporting" />)}
            </div>
          )}
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-red-500 mb-4">
            Contradicting Studies ({claim.contradictingStudies.length})
          </h2>
          {claim.contradictingStudies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contradicting studies indexed.</p>
          ) : (
            <div className="space-y-3">
              {claim.contradictingStudies.map(link => <StudyCard key={link.id} link={link} kind="contradicting" />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
