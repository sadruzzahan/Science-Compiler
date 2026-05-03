import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListReviewQueue,
  getListReviewQueueQueryKey,
  useReviewClaim,
  type PendingClaim,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, XCircle, Pencil, Flag, Loader2 } from "lucide-react";

function confidenceBadge(c: number) {
  if (c < 0.5) return <Badge className="bg-red-100 text-red-800 border-red-200">low {c.toFixed(2)}</Badge>;
  if (c < 0.7) return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">{c.toFixed(2)}</Badge>;
  return <Badge variant="secondary">{c.toFixed(2)}</Badge>;
}

export default function AdminReviewQueuePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PendingClaim | null>(null);
  const [editText, setEditText] = useState("");
  const [notes, setNotes] = useState("");

  const { data, isLoading, isError } = useListReviewQueue(
    { limit: 100 },
    { query: { queryKey: getListReviewQueueQueryKey({ limit: 100 }) } },
  );

  const reviewMutation = useReviewClaim({
    mutation: {
      onSuccess: () => {
        toast({ title: "Claim updated" });
        qc.invalidateQueries({ queryKey: getListReviewQueueQueryKey() });
        setEditing(null);
        setEditText("");
        setNotes("");
      },
      onError: () => toast({ title: "Could not update claim", variant: "destructive" }),
    },
  });

  function decide(claim: PendingClaim, decision: "approve" | "reject") {
    reviewMutation.mutate({ id: claim.id, data: { decision, notes: notes || null } });
  }

  function saveEdit() {
    if (!editing) return;
    reviewMutation.mutate({
      id: editing.id,
      data: {
        decision: "edit",
        notes: notes || null,
        edited: { claimText: editText },
      },
    });
  }

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight" data-testid="page-title">Claim Review Queue</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Low-confidence extractions and community-flagged claims awaiting human review.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            Pending {data ? <Badge variant="secondary">{data.total}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-destructive text-sm"><AlertTriangle className="h-4 w-4" /> Failed to load review queue.</div>
          ) : !data?.claims.length ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
              All caught up — no pending claims.
            </div>
          ) : (
            <div className="divide-y">
              {data.claims.map((c) => (
                <div key={c.id} className="py-4" data-testid={`pending-claim-${c.id}`}>
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex-1 min-w-0">
                      <Link href={`/claims/${c.id}`}>
                        <p className="text-sm font-medium leading-snug hover:underline cursor-pointer">{c.claimText}</p>
                      </Link>
                      {c.paperTitle && (
                        <p className="text-xs text-muted-foreground italic mt-1 truncate">from: {c.paperTitle}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {confidenceBadge(c.confidence)}
                      {c.flagCount > 0 && (
                        <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                          <Flag className="h-3 w-3 mr-1" /> {c.flagCount} flag{c.flagCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <Badge variant="outline" className="text-[10px] capitalize">{c.direction}</Badge>
                      <Badge variant="outline" className="text-[10px]">{c.evidenceQuality}</Badge>
                      {c.topicName && <span>· {c.topicName}</span>}
                      <span>· {new Date(c.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm" variant="outline" className="h-7"
                        onClick={() => { setEditing(c); setEditText(c.claimText); setNotes(""); }}
                        data-testid={`edit-btn-${c.id}`}
                      >
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-7 text-red-600 hover:text-red-700"
                        disabled={reviewMutation.isPending}
                        onClick={() => decide(c, "reject")}
                        data-testid={`reject-btn-${c.id}`}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm" className="h-7"
                        disabled={reviewMutation.isPending}
                        onClick={() => decide(c, "approve")}
                        data-testid={`approve-btn-${c.id}`}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Claim</DialogTitle>
            <DialogDescription>
              Editing implicitly approves the claim with your revised wording.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Claim text</label>
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={4}
                data-testid="edit-claim-text"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Reviewer notes</label>
              <Input
                placeholder="Optional"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="edit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={reviewMutation.isPending || !editText.trim()} data-testid="save-edit-btn">
              {reviewMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save & Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
