import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";

// Temporary stubs for pages
function Home() { return <div className="p-8"><h1 className="text-2xl font-bold">Query Knowledge Base</h1><p>Search interface coming soon.</p></div>; }
function TopicDetail({ params }: { params: { id: string } }) { return <div className="p-8">Topic Detail {params.id}</div>; }
function PapersList() { return <div className="p-8">Papers List</div>; }
function PaperDetail({ params }: { params: { id: string } }) { return <div className="p-8">Paper Detail {params.id}</div>; }
function ClaimsList() { return <div className="p-8">Claims List</div>; }
function ClaimDetail({ params }: { params: { id: string } }) { return <div className="p-8">Claim Detail {params.id}</div>; }

import TopicsPage from "@/pages/topics/index";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/topics" component={TopicsPage} />
        <Route path="/topics/:id" component={TopicDetail} />
        <Route path="/papers" component={PapersList} />
        <Route path="/papers/:id" component={PaperDetail} />
        <Route path="/claims" component={ClaimsList} />
        <Route path="/claims/:id" component={ClaimDetail} />
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
