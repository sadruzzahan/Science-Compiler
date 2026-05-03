import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { customFetch } from "@workspace/api-client-react";

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
}

export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useAuth();
  return useQuery<CurrentUser>({
    queryKey: ["currentUser", isSignedIn],
    enabled: isLoaded && !!isSignedIn,
    queryFn: () => customFetch<CurrentUser>("/api/users/me", { responseType: "json" }),
    staleTime: 60_000,
  });
}
