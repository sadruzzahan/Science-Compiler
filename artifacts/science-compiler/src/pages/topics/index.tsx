import { Link } from "wouter";
import { useGetTopicsStats, getGetTopicsStatsQueryKey, useListTopics, getListTopicsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function TopicsPage() {
  const { data: stats, isLoading: statsLoading } = useGetTopicsStats({
    query: { queryKey: getGetTopicsStatsQueryKey() }
  });

  const { data: topics, isLoading: topicsLoading } = useListTopics({
    query: { queryKey: getListTopicsQueryKey() }
  });

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="page-title">Research Topics</h1>
        <p className="text-muted-foreground mt-2">Browse the knowledge base by specific scientific domains and topic areas.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Topics</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold">{stats?.totalTopics || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Well-Established</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold text-green-600 dark:text-green-500">{stats?.wellEstablishedCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contested</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-500">{stats?.contestedCount || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Preliminary</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-3xl font-bold text-blue-600 dark:text-blue-500">{stats?.preliminaryCount || 0}</div>}
          </CardContent>
        </Card>
      </div>

      {topicsLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Card key={i} className="flex flex-col h-[200px]">
              <CardHeader>
                <Skeleton className="h-6 w-2/3 mb-2" />
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
              <CardContent className="flex-1 mt-auto">
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-2 w-full mt-4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {topics?.map(topic => (
            <Link key={topic.id} href={`/topics/${topic.id}`} className="block h-full transition-transform hover:-translate-y-1 hover:shadow-md" data-testid={`topic-card-${topic.id}`}>
              <Card className="h-full flex flex-col cursor-pointer border-border hover:border-primary/50 transition-colors">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <Badge variant="outline" className="mb-2 bg-muted text-muted-foreground font-medium text-xs rounded-sm px-2 py-0.5 border-none">
                      {topic.domain}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg leading-tight line-clamp-2">{topic.name}</CardTitle>
                  <CardDescription className="line-clamp-2 mt-2">{topic.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto pt-0">
                  <div className="flex justify-between items-center text-sm text-muted-foreground mb-3">
                    <span>{topic.claimCount} claims</span>
                    <span>{topic.paperCount} papers</span>
                  </div>
                  
                  {/* Consensus Distribution Bar */}
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden flex">
                    {(topic.wellEstablishedCount > 0 || topic.contestedCount > 0) ? (
                      <>
                        <div className="bg-green-500 h-full" style={{ width: `${(topic.wellEstablishedCount / topic.claimCount) * 100}%` }} title="Well-Established" />
                        <div className="bg-yellow-500 h-full" style={{ width: `${(topic.contestedCount / topic.claimCount) * 100}%` }} title="Contested" />
                        <div className="bg-blue-500 h-full" style={{ width: `${((topic.claimCount - topic.wellEstablishedCount - topic.contestedCount) / topic.claimCount) * 100}%` }} title="Preliminary" />
                      </>
                    ) : (
                      <div className="bg-blue-500 h-full w-full" title="Preliminary" />
                    )}
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
