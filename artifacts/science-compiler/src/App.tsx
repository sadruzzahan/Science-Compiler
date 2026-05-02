import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import QueryPage from "@/pages/query";
import TopicsPage from "@/pages/topics";
import TopicDetailPage from "@/pages/topics/detail";
import PapersPage from "@/pages/papers";
import PaperDetailPage from "@/pages/papers/detail";
import ClaimsPage from "@/pages/claims";
import ClaimDetailPage from "@/pages/claims/detail";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={QueryPage} />
        <Route path="/topics" component={TopicsPage} />
        <Route path="/topics/:id" component={TopicDetailPage} />
        <Route path="/papers" component={PapersPage} />
        <Route path="/papers/:id" component={PaperDetailPage} />
        <Route path="/claims" component={ClaimsPage} />
        <Route path="/claims/:id" component={ClaimDetailPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
