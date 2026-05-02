import { Link } from "wouter";
import { useGetTopic, getGetTopicQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft } from "lucide-react";
import { ConsensusBadge, EvidenceQualityBadge } from "@/components/badges";

export default function TopicDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { data: topic, isLoading, isError } = useGetTopic(id, {
    query: { enabled: !!id, queryKey: getGetTopicQueryKey(id) },
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

  if (isError || !topic) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-muted-foreground">
        <p>Topic not found.</p>
        <Link href="/topics"><Button variant="outline" className="mt-4">Back to Topics</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <Link href="/topics">
        <Button variant="ghost" size="sm" className="mb-6 -ml-2" data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" /> Topics
        </Button>
      </Link>

      <div className="mb-8">
        <Badge variant="outline" className="mb-3 text-xs">{topic.domain}</Badge>
        <h1 className="text-3xl font-bold leading-tight text-foreground mb-3" data-testid="topic-title">{topic.name}</h1>
        <p className="text-muted-foreground text-lg">{topic.description}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8 p-5 rounded-lg border bg-card">
        <div>
          <div className="text-2xl font-bold text-foreground" data-testid="stat-claims">{topic.claimCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Claims</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground" data-testid="stat-papers">{topic.paperCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Papers</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-green-600" data-testid="stat-established">{topic.wellEstablishedCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Established</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-yellow-600" data-testid="stat-contested">{topic.contestedCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Contested</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-blue-600" data-testid="stat-preliminary">{topic.preliminaryCount}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Preliminary</div>
        </div>
      </div>

      <Separator className="mb-6" />

      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Claims in this topic ({topic.claims.length})
        </h2>
        {topic.claims.length === 0 ? (
          <p className="text-muted-foreground text-sm">No claims indexed yet.</p>
        ) : (
          <div className="space-y-3">
            {topic.claims.map(claim => (
              <Link key={claim.id} href={`/claims/${claim.id}`} data-testid={`claim-card-${claim.id}`}>
                <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">{claim.claimText}</p>
                        <div className="flex gap-2 mt-2 items-center">
                          <Badge variant="outline" className="text-xs capitalize">{claim.direction}</Badge>
                          <EvidenceQualityBadge quality={claim.evidenceQuality} />
                          {claim.supportingCount != null && (
                            <span className="text-xs text-muted-foreground">
                              <span className="text-green-600 font-medium">{claim.supportingCount}</span> supporting · <span className="text-red-500 font-medium">{claim.contradictingCount}</span> contradicting
                            </span>
                          )}
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
