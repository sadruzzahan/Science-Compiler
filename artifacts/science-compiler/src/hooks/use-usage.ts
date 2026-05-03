import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { customFetch } from "@workspace/api-client-react";

export interface UsageMe {
  plan: "user" | "pro" | "admin";
  syntheses: {
    todayCount: number;
    dailyLimit: number | null;
    remaining: number | null;
    resetAtUtc: string;
  };
  budget: {
    exhausted: boolean;
    spendUsd: number;
    capUsd: number | null;
    retryAfterUtc: string;
    retryAfterSeconds: number;
  };
}

export function useUsageMe() {
  const { isSignedIn, isLoaded } = useAuth();
  return useQuery<UsageMe>({
    queryKey: ["usageMe", isSignedIn],
    enabled: isLoaded && !!isSignedIn,
    queryFn: () => customFetch<UsageMe>("/api/usage/me", { responseType: "json" }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
