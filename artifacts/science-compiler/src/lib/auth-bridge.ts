import { setAuthTokenGetter } from "@workspace/api-client-react";
import { toast } from "sonner";

let installedToast = false;

export function installClerkBridge(getToken: () => Promise<string | null>) {
  // Web app uses cookies; we don't actually need a bearer token here, but
  // attaching one makes SSE / cross-origin proxy edge cases robust.
  setAuthTokenGetter(getToken);
  if (!installedToast) {
    installedToast = true;
    window.addEventListener("unhandledrejection", (e) => {
      const status = (e.reason as { status?: number } | null)?.status;
      if (status === 401) toast.error("Please sign in to continue.");
      else if (status === 403) toast.error("You don't have permission for this action.");
    });
  }
}
