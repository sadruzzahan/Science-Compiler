import { useState } from "react";
import { Link } from "wouter";
import { useListClaims, getListClaimsQueryKey } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Search, FlaskConical } from "lucide-react";
import { ConsensusBadge, EvidenceQualityBadge } from "@/components/badges";

const CONSENSUS_OPTIONS = ["well-established", "contested", "preliminary", "insufficient evidence"];
const QUALITY_GRADES = ["A", "B", "C", "D"];
const DIRECTIONS = ["protective", "harmful", "neutral", "mixed"];

export default function ClaimsPage() {
  const [search, setSearch] = useState("");
  const [consensusStatus, setConsensusStatus] = useState<string | undefined>(undefined);
  const [evidenceQuality, setEvidenceQuality] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<string | undefined>(undefined);

  const params = {
    search: search || undefined,
    consensusStatus: consensusStatus || undefined,
    evidenceQuality: evidenceQuality || undefined,
    direction: direction || undefined,
    limit: 30,
  };

  const { data, isLoading } = useListClaims(params, {
    query: { queryKey: getListClaimsQueryKey(params) },
  });

  function clearFilters() {
    setSearch("");
    setConsensusStatus(undefined);
    setEvidenceQuality(undefined);
    setDirection(undefined);
  }

  const hasFilters = !!search || !!consensusStatus || !!evidenceQuality || !!direction;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="page-title">Claims</h1>
        <p className="text-muted-foreground mt-2">All extracted scientific claims with evidence-graded consensus.</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            data-testid="input-search-claims"
            placeholder="Search claims..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={consensusStatus ?? "all"} onValueChange={(v) => setConsensusStatus(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-44" data-testid="select-consensus">
            <SelectValue placeholder="Consensus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All consensus</SelectItem>
            {CONSENSUS_OPTIONS.map(o => <SelectItem key={o} value={o} className="capitalize">{o}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={evidenceQuality ?? "all"} onValueChange={(v) => setEvidenceQuality(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-32" data-testid="select-quality">
            <SelectValue placeholder="Quality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All grades</SelectItem>
            {QUALITY_GRADES.map(g => <SelectItem key={g} value={g}>Grade {g}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={direction ?? "all"} onValueChange={(v) => setDirection(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-36" data-testid="select-direction">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All directions</SelectItem>
            {DIRECTIONS.map(d => <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>)}
          </SelectContent>
        </Select>

        {hasFilters && (
          <button onClick={clearFilters} className="text-sm text-muted-foreground hover:text-foreground" data-testid="button-clear-filters">
            Clear
          </button>
        )}
      </div>

      {!isLoading && data && (
        <div className="text-sm text-muted-foreground mb-4">{data.total} claim{data.total !== 1 ? "s" : ""} found</div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : data?.claims.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground border border-dashed rounded-lg">
          <FlaskConical className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>No claims match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data?.claims.map(claim => (
            <Link key={claim.id} href={`/claims/${claim.id}`} data-testid={`claim-card-${claim.id}`}>
              <Card className="hover:border-primary/40 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug mb-2">{claim.claimText}</p>
                      <div className="flex flex-wrap gap-2 items-center text-xs text-muted-foreground">
                        <span className="text-primary/80">{claim.topicName}</span>
                        <span>·</span>
                        <Badge variant="outline" className="text-xs capitalize">{claim.direction}</Badge>
                        <Badge variant="outline" className="text-xs capitalize">{claim.methodologyType}</Badge>
                        <span className="text-muted-foreground">{claim.population}</span>
                        {claim.supportingCount != null && claim.contradictingCount != null && (
                          <>
                            <span>·</span>
                            <span><span className="text-green-600 font-medium">{claim.supportingCount}</span> supporting · <span className="text-red-500 font-medium">{claim.contradictingCount}</span> contradicting</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {claim.consensusStatus && <ConsensusBadge status={claim.consensusStatus} compact />}
                      <EvidenceQualityBadge quality={claim.evidenceQuality} />
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
