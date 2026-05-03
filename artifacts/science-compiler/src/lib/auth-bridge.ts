import { setAuthTokenGetter, setAuthErrorHandler } from "@workspace/api-client-react";
import { toast } from "sonner";

let lastToastAt = 0;
function debounceToast(msg: string) {
  const now = Date.now();
  if (now - lastToastAt < 1500) return;
  lastToastAt = now;
  toast.error(msg);
}

export function installClerkBridge(getToken: () => Promise<string | null>) {
  // Web app uses cookies; we don't actually need a bearer token here, but
  // attaching one makes SSE / cross-origin proxy edge cases robust.
  setAuthTokenGetter(getToken);
  // Real interceptor: invoked by customFetch on every 401/403, regardless
  // of whether React Query swallows the rejection.
  setAuthErrorHandler((status) => {
    if (status === 401) debounceToast("Your session expired. Please sign in to continue.");
    else debounceToast("You don't have permission for this action.");
  });
}
