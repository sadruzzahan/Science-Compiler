import { Link } from "wouter";
import { useGetPaper, getGetPaperQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { EvidenceQualityBadge, ReplicationBadge, ConsensusBadge } from "@/components/badges";

export default function PaperDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);

  const { data: paper, isLoading, isError } = useGetPaper(id, {
    query: { enabled: !!id, queryKey: getGetPaperQueryKey(id) },
  });

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError || !paper) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-muted-foreground">
        <p>Paper not found.</p>
        <Link href="/papers"><Button variant="outline" className="mt-4">Back to Papers</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/papers">
        <Button variant="ghost" size="sm" className="mb-6 -ml-2" data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" /> Papers
        </Button>
      </Link>

      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h1 className="text-2xl font-bold leading-snug text-foreground" data-testid="paper-title">{paper.title}</h1>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <EvidenceQualityBadge quality={paper.evidenceQuality} />
            <ReplicationBadge status={paper.replicationStatus} />
          </div>
        </div>
        <p className="text-muted-foreground">
          {paper.authors} · <em>{paper.journal}</em> · {paper.publicationYear}
        </p>
        <div className="flex flex-wrap gap-3 mt-4">
          <Badge variant="outline" className="capitalize">{paper.methodologyType}</Badge>
          {paper.sampleSize && <Badge variant="outline">n={paper.sampleSize.toLocaleString()}</Badge>}
          {paper.pValue && <Badge variant="outline">p={paper.pValue}</Badge>}
          <Link href={`/topics/${paper.topicId}`}>
            <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/70" data-testid="badge-topic">{paper.topicName}</Badge>
          </Link>
        </div>
        {(paper.doi || paper.pmid || paper.openAccessUrl) && (
          <div className="flex gap-4 mt-4 text-sm">
            {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener" className="text-primary hover:underline flex items-center gap-1" data-testid="link-doi">DOI <ExternalLink className="h-3 w-3" /></a>}
            {paper.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}`} target="_blank" rel="noopener" className="text-primary hover:underline flex items-center gap-1" data-testid="link-pubmed">PubMed <ExternalLink className="h-3 w-3" /></a>}
            {paper.openAccessUrl && <a href={paper.openAccessUrl} target="_blank" rel="noopener" className="text-primary hover:underline flex items-center gap-1" data-testid="link-full-text">Full Text <ExternalLink className="h-3 w-3" /></a>}
          </div>
        )}
        {((paper.sources && paper.sources.length > 0) || paper.isPreprint === 1 || paper.fullTextStatus === "fetched") && (
          <div className="flex flex-wrap items-center gap-2 mt-4" data-testid="source-badges">
            {paper.sources && paper.sources.length > 0 && (
              <>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Indexed by:</span>
                {paper.sources.map((s) => (
                  s.url
                    ? <a key={s.sourceId} href={s.url} target="_blank" rel="noopener" data-testid={`source-${s.sourceId}`}>
                        <Badge variant="outline" className="text-xs hover:bg-primary/10 cursor-pointer">{s.displayName}</Badge>
                      </a>
                    : <Badge key={s.sourceId} variant="outline" className="text-xs" data-testid={`source-${s.sourceId}`}>{s.displayName}</Badge>
                ))}
              </>
            )}
            {paper.isPreprint === 1 && <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">Preprint</Badge>}
            {paper.fullTextStatus === "fetched" && <Badge variant="secondary" className="text-xs">Full text</Badge>}
          </div>
        )}
      </div>

      <Separator className="mb-6" />

      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Abstract</h2>
        <p className="text-sm leading-relaxed text-foreground/90" data-testid="paper-abstract">{paper.abstract}</p>
      </div>

      <Separator className="mb-6" />

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Extracted Claims ({paper.claims.length})
        </h2>
        {paper.claims.length === 0 ? (
          <p className="text-muted-foreground text-sm">No claims extracted yet.</p>
        ) : (
          <div className="space-y-3">
            {paper.claims.map(claim => (
              <Link key={claim.id} href={`/claims/${claim.id}`} data-testid={`claim-card-${claim.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{claim.claimText}</p>
                        <div className="flex gap-2 mt-2">
                          <Badge variant="outline" className="text-xs capitalize">{claim.direction}</Badge>
                          <EvidenceQualityBadge quality={claim.evidenceQuality} />
                        </div>
                      </div>
                      {claim.consensusStatus && <ConsensusBadge status={claim.consensusStatus} compact />}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
