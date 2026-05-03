import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListIngestionRuns,
  getListIngestionRunsQueryKey,
  useListIngestionConfigs,
  getListIngestionConfigsQueryKey,
  useTriggerIngestion,
  useCreateIngestionConfig,
  useUpdateIngestionConfig,
  useDeleteIngestionConfig,
  useListTopics,
  getListTopicsQueryKey,
  useGetIngestionRunResults,
  getGetIngestionRunResultsQueryKey,
  type IngestionConfig,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Play, Plus, Pencil, Trash2, AlertTriangle, CheckCircle, Clock, Loader2, RefreshCw, FileSearch } from "lucide-react";

function statusBadge(status: string) {
  if (status === "completed") return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
  if (status === "running") return <Badge className="bg-blue-100 text-blue-800 border-blue-200"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-800 border-red-200"><AlertTriangle className="h-3 w-3 mr-1" />Failed</Badge>;
  return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{status}</Badge>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function duration(start: string, end?: string | null) {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

interface ConfigFormData {
  topicId: string;
  pubmedQuery: string;
  maxPapersPerRun: string;
  llmModel: string;
  enabled: string;
  sources: string[];
}

const ALL_SOURCES: Array<{ id: string; label: string }> = [
  { id: "pubmed", label: "PubMed" },
  { id: "semantic-scholar", label: "Semantic Scholar" },
  { id: "openalex", label: "OpenAlex" },
  { id: "biorxiv", label: "bioRxiv" },
];

const DEFAULT_FORM: ConfigFormData = {
  topicId: "",
  pubmedQuery: "",
  maxPapersPerRun: "20",
  llmModel: "gpt-4o-mini",
  enabled: "1",
  sources: ["pubmed"],
};

export default function AdminIngestionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<IngestionConfig | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [form, setForm] = useState<ConfigFormData>(DEFAULT_FORM);
  const [resultsRunId, setResultsRunId] = useState<number | null>(null);
  const [resultsTab, setResultsTab] = useState<"papers" | "claims">("papers");
  const [resultsSearch, setResultsSearch] = useState("");

  const { data: runResults, isLoading: resultsLoading, isError: resultsError } = useGetIngestionRunResults(
    resultsRunId ?? 0,
    {
      query: {
        queryKey: getGetIngestionRunResultsQueryKey(resultsRunId ?? 0),
        enabled: resultsRunId !== null,
      },
    }
  );

  const { data: runs, isLoading: runsLoading, isError: runsError } = useListIngestionRuns(
    { limit: 50 },
    { query: { queryKey: getListIngestionRunsQueryKey({ limit: 50 }) } }
  );

  const { data: configs, isLoading: configsLoading, isError: configsError } = useListIngestionConfigs({
    query: { queryKey: getListIngestionConfigsQueryKey() }
  });

  const { data: topics } = useListTopics({ query: { queryKey: getListTopicsQueryKey() } });

  const triggerMutation = useTriggerIngestion({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Ingestion started", description: data.message });
        setTimeout(() => queryClient.invalidateQueries({ queryKey: getListIngestionRunsQueryKey() }), 1500);
      },
      onError: () => toast({ title: "Error", description: "Could not trigger ingestion. Another run may be in progress.", variant: "destructive" }),
    }
  });

  const createMutation = useCreateIngestionConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Config created" });
        setConfigDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getListIngestionConfigsQueryKey() });
      },
      onError: () => toast({ title: "Error creating config", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateIngestionConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Config updated" });
        setConfigDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getListIngestionConfigsQueryKey() });
      },
      onError: () => toast({ title: "Error updating config", variant: "destructive" }),
    }
  });

  const deleteMutation = useDeleteIngestionConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Config deleted" });
        queryClient.invalidateQueries({ queryKey: getListIngestionConfigsQueryKey() });
      },
      onError: () => toast({ title: "Error deleting config", variant: "destructive" }),
    }
  });

  function openCreate() {
    setEditingConfig(null);
    setForm(DEFAULT_FORM);
    setConfigDialogOpen(true);
  }

  function openEdit(config: IngestionConfig) {
    setEditingConfig(config);
    setForm({
      topicId: String(config.topicId),
      pubmedQuery: config.pubmedQuery,
      maxPapersPerRun: String(config.maxPapersPerRun),
      llmModel: config.llmModel,
      enabled: String(config.enabled),
      sources: config.sources && config.sources.length > 0 ? config.sources : ["pubmed"],
    });
    setConfigDialogOpen(true);
  }

  function toggleSource(id: string) {
    setForm((f) => {
      const has = f.sources.includes(id);
      const next = has ? f.sources.filter((s) => s !== id) : [...f.sources, id];
      // Always keep at least one source selected; the API enforces this too.
      return { ...f, sources: next.length === 0 ? f.sources : next };
    });
  }

  function handleSubmit() {
    if (!form.topicId || !form.pubmedQuery) {
      toast({ title: "Topic and PubMed query are required", variant: "destructive" });
      return;
    }
    if (form.sources.length === 0) {
      toast({ title: "Select at least one source", variant: "destructive" });
      return;
    }
    const payload = {
      topicId: Number(form.topicId),
      pubmedQuery: form.pubmedQuery,
      maxPapersPerRun: Number(form.maxPapersPerRun),
      llmModel: form.llmModel,
      enabled: Number(form.enabled),
      sources: form.sources,
    };
    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="page-title">AI Ingestion Pipeline</h1>
          <p className="text-muted-foreground mt-2">Manage PubMed ingestion configs and monitor pipeline runs.</p>
        </div>
        <Button
          onClick={() => triggerMutation.mutate({ data: {} })}
          disabled={triggerMutation.isPending}
          data-testid="trigger-ingestion-btn"
        >
          {triggerMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Now
        </Button>
      </div>

      <div className="grid gap-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Ingestion Configs</CardTitle>
            <Button size="sm" variant="outline" onClick={openCreate} data-testid="add-config-btn">
              <Plus className="h-4 w-4 mr-1" /> Add Config
            </Button>
          </CardHeader>
          <CardContent>
            {configsLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : configsError ? (
              <div className="flex items-center gap-2 text-destructive text-sm"><AlertTriangle className="h-4 w-4" /> Failed to load configs.</div>
            ) : !configs?.length ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No ingestion configs yet. Add one to get started.</div>
            ) : (
              <div className="divide-y">
                {configs.map((cfg) => (
                  <div key={cfg.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm">{cfg.topicName ?? `Topic #${cfg.topicId}`}</span>
                        <Badge variant={cfg.enabled ? "default" : "secondary"} className="text-xs">
                          {cfg.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{cfg.pubmedQuery}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Max {cfg.maxPapersPerRun} papers · {cfg.llmModel}
                      </p>
                      {cfg.sources && cfg.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {cfg.sources.map((s) => (
                            <Badge key={s} variant="outline" className="text-[10px] capitalize">{s}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => openEdit(cfg)}
                        data-testid={`edit-config-${cfg.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(cfg.id)}
                        data-testid={`delete-config-${cfg.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold">Recent Runs</CardTitle>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => queryClient.invalidateQueries({ queryKey: getListIngestionRunsQueryKey() })}
              data-testid="refresh-runs-btn"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {runsLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : runsError ? (
              <div className="flex items-center gap-2 text-destructive text-sm"><AlertTriangle className="h-4 w-4" /> Failed to load runs.</div>
            ) : !runs?.length ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No ingestion runs yet. Click "Run Now" to start one.</div>
            ) : (
              <div className="divide-y">
                {runs.map((run) => (
                  <div key={run.id} className="py-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        {statusBadge(run.status)}
                        <span className="text-sm font-medium">{run.topicName ?? (run.topicId ? `Topic #${run.topicId}` : "All Topics")}</span>
                        <span className="text-xs text-muted-foreground capitalize">· {run.triggeredBy}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
                        {(run.status === "completed" || run.status === "failed") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => {
                              setResultsRunId(run.id);
                              setResultsTab("papers");
                              setResultsSearch("");
                            }}
                            data-testid={`view-results-${run.id}`}
                          >
                            <FileSearch className="h-3 w-3 mr-1" /> View Results
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{run.papersFound} found</span>
                      <span>{run.papersProcessed} processed</span>
                      <span>{run.claimsExtracted} claims</span>
                      {run.errorsCount > 0 && <span className="text-destructive">{run.errorsCount} errors</span>}
                      <span>· {duration(run.startedAt, run.completedAt)}</span>
                    </div>
                    {run.errorDetails && (
                      <p className="mt-1 text-xs text-destructive bg-destructive/10 rounded px-2 py-1 truncate">{run.errorDetails}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingConfig ? "Edit Config" : "Add Ingestion Config"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-topic">Topic</Label>
              <Select
                value={form.topicId}
                onValueChange={(v) => setForm((f) => ({ ...f, topicId: v }))}
              >
                <SelectTrigger id="cfg-topic" data-testid="cfg-topic-select">
                  <SelectValue placeholder="Select a topic" />
                </SelectTrigger>
                <SelectContent>
                  {topics?.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-query">PubMed Search Query</Label>
              <Input
                id="cfg-query"
                data-testid="cfg-query-input"
                placeholder='e.g. "vitamin D" AND "cardiovascular"'
                value={form.pubmedQuery}
                onChange={(e) => setForm((f) => ({ ...f, pubmedQuery: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-max">Max Papers / Run</Label>
                <Input
                  id="cfg-max"
                  type="number"
                  min={1}
                  max={200}
                  value={form.maxPapersPerRun}
                  onChange={(e) => setForm((f) => ({ ...f, maxPapersPerRun: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-model">LLM Model</Label>
                <Input
                  id="cfg-model"
                  value={form.llmModel}
                  onChange={(e) => setForm((f) => ({ ...f, llmModel: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Sources</Label>
              <div className="flex flex-wrap gap-2" data-testid="cfg-sources">
                {ALL_SOURCES.map((s) => {
                  const active = form.sources.includes(s.id);
                  return (
                    <Button
                      key={s.id}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => toggleSource(s.id)}
                      data-testid={`cfg-source-${s.id}`}
                    >
                      {s.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Same query is fanned out across each selected source; results are deduped by DOI/title.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-enabled">Status</Label>
              <Select
                value={form.enabled}
                onValueChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
              >
                <SelectTrigger id="cfg-enabled">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Enabled</SelectItem>
                  <SelectItem value="0">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isMutating} data-testid="save-config-btn">
              {isMutating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingConfig ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resultsRunId !== null} onOpenChange={(open) => !open && setResultsRunId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Ingestion Run #{resultsRunId} Results</DialogTitle>
            <DialogDescription>
              {runResults?.run
                ? <>Papers and claims created during this run for {runResults.run.topicName ?? (runResults.run.topicId ? `Topic #${runResults.run.topicId}` : "all topics")}.</>
                : "Loading run details..."}
            </DialogDescription>
          </DialogHeader>
          {resultsLoading ? (
            <div className="space-y-2 py-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : resultsError ? (
            <div className="flex items-center gap-2 text-destructive text-sm py-4"><AlertTriangle className="h-4 w-4" /> Failed to load results.</div>
          ) : runResults ? (
            <Tabs value={resultsTab} onValueChange={(v) => setResultsTab(v as "papers" | "claims")}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <TabsList>
                  <TabsTrigger value="papers" data-testid="results-tab-papers">
                    Papers ({runResults.papers.length})
                  </TabsTrigger>
                  <TabsTrigger value="claims" data-testid="results-tab-claims">
                    Claims ({runResults.claims.length})
                  </TabsTrigger>
                </TabsList>
                <Input
                  placeholder={resultsTab === "papers" ? "Search title, authors, journal..." : "Search claim text or population..."}
                  value={resultsSearch}
                  onChange={(e) => setResultsSearch(e.target.value)}
                  className="max-w-xs h-8"
                  data-testid="results-search-input"
                />
              </div>
              <TabsContent value="papers">
                <ScrollArea className="h-[420px] pr-3">
                  {(() => {
                    const q = resultsSearch.trim().toLowerCase();
                    const filtered = runResults.papers.filter(p =>
                      !q || p.title.toLowerCase().includes(q) || p.authors.toLowerCase().includes(q) || p.journal.toLowerCase().includes(q)
                    );
                    if (!filtered.length) return <div className="text-center py-10 text-sm text-muted-foreground">No papers match.</div>;
                    return (
                      <div className="divide-y">
                        {filtered.map(p => (
                          <div key={p.id} className="py-3" data-testid={`result-paper-${p.id}`}>
                            <div className="flex items-start justify-between gap-3 mb-1">
                              <p className="text-sm font-medium leading-snug">{p.title}</p>
                              <Badge variant="secondary" className="text-xs flex-shrink-0">{p.claimsCount} claims</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{p.authors}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                              <span>{p.journal} · {p.publicationYear}</span>
                              <Badge variant="outline" className="text-[10px]">{p.methodologyType}</Badge>
                              <Badge variant="outline" className="text-[10px]">{p.evidenceQuality}</Badge>
                              {p.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer" className="text-primary hover:underline">PMID {p.pmid}</a>}
                              {p.doi && <a href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">DOI</a>}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </ScrollArea>
              </TabsContent>
              <TabsContent value="claims">
                <ScrollArea className="h-[420px] pr-3">
                  {(() => {
                    const q = resultsSearch.trim().toLowerCase();
                    const filtered = runResults.claims.filter(c =>
                      !q || c.claimText.toLowerCase().includes(q) || c.population.toLowerCase().includes(q) || c.paperTitle.toLowerCase().includes(q)
                    );
                    if (!filtered.length) return <div className="text-center py-10 text-sm text-muted-foreground">No claims match.</div>;
                    return (
                      <div className="divide-y">
                        {filtered.map(c => (
                          <div key={c.id} className="py-3" data-testid={`result-claim-${c.id}`}>
                            <p className="text-sm leading-snug mb-1">{c.claimText}</p>
                            <p className="text-xs text-muted-foreground italic mb-1 truncate">from: {c.paperTitle}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                              <Badge variant="outline" className="text-[10px]">{c.direction}</Badge>
                              <Badge variant="outline" className="text-[10px]">{c.evidenceQuality}</Badge>
                              <span>{c.population}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResultsRunId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmId !== null} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Ingestion Config?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Future scheduled runs for this config will stop.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmId !== null) deleteMutation.mutate({ id: deleteConfirmId });
                setDeleteConfirmId(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
