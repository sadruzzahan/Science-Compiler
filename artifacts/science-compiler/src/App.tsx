import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
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
import AdminIngestionPage from "@/pages/admin/ingestion";
import SignInPage from "@/components/auth/sign-in-page";
import SignUpPage from "@/components/auth/sign-up-page";
import AccountPage from "@/pages/account";
import { RequireAuth } from "@/components/auth/require-auth";
import { queryClient } from "@/lib/queryClient";
import { installClerkBridge } from "@/lib/auth-bridge";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
  },
};

function stripBase(p: string): string {
  return basePath && p.startsWith(basePath) ? p.slice(basePath.length) || "/" : p;
}

function ClerkBridge() {
  const { getToken } = useAuth();
  const { addListener } = useClerk();
  const qc = useQueryClient();

  useEffect(() => {
    installClerkBridge(() => getToken());
  }, [getToken]);

  useEffect(() => {
    const unsub = addListener(({ user }) => {
      if (!user) qc.clear();
    });
    return unsub;
  }, [addListener, qc]);

  return null;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route>
        <AppLayout>
          <Switch>
            <Route path="/">
              <RequireAuth>
                <QueryPage />
              </RequireAuth>
            </Route>
            <Route path="/query">
              <RequireAuth>
                <QueryPage />
              </RequireAuth>
            </Route>
            <Route path="/topics" component={TopicsPage} />
            <Route path="/topics/:id" component={TopicDetailPage} />
            <Route path="/papers" component={PapersPage} />
            <Route path="/papers/:id" component={PaperDetailPage} />
            <Route path="/claims" component={ClaimsPage} />
            <Route path="/claims/:id" component={ClaimDetailPage} />
            <Route path="/account">
              <RequireAuth>
                <AccountPage />
              </RequireAuth>
            </Route>
            <Route path="/admin/ingestion">
              <RequireAuth adminOnly>
                <AdminIngestionPage />
              </RequireAuth>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </Route>
    </Switch>
  );
}

function ClerkProviderWithRouter() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey!}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkBridge />
        <TooltipProvider>
          <AppRoutes />
          <Toaster />
          <SonnerToaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRouter />
    </WouterRouter>
  );
}

export default App;
