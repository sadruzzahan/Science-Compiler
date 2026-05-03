import { type ReactNode } from "react";
import { Show, useClerk } from "@clerk/react";
import { Redirect, useLocation } from "wouter";
import { useCurrentUser } from "@/hooks/use-current-user";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

interface RequireAuthProps {
  children: ReactNode;
  adminOnly?: boolean;
}

export function RequireAuth({ children, adminOnly = false }: RequireAuthProps) {
  const { loaded } = useClerk();
  const { data: user, isLoading } = useCurrentUser();
  const [location] = useLocation();
  const returnTo = encodeURIComponent(location || "/");

  if (!loaded) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      <Show when="signed-out">
        <Redirect to={`/sign-in?redirect=${returnTo}`} />
      </Show>
      <Show when="signed-in">
        {isLoading ? (
          <div className="p-8 text-muted-foreground">Loading account…</div>
        ) : adminOnly && user?.role !== "admin" ? (
          <div className="p-8">
            <h1 className="text-2xl font-semibold">Access denied</h1>
            <p className="mt-2 text-muted-foreground">
              This page requires admin privileges. Contact your administrator if you believe this is in error.
            </p>
          </div>
        ) : user?.status === "suspended" ? (
          <div className="p-8">
            <h1 className="text-2xl font-semibold">Account suspended</h1>
            <p className="mt-2 text-muted-foreground">Please contact an administrator.</p>
          </div>
        ) : (
          <>{children}</>
        )}
      </Show>
    </>
  );
}

export { basePath };
