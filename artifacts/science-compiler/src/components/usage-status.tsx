import { AlertTriangle, Gauge } from "lucide-react";
import { useUsageMe } from "@/hooks/use-usage";

/**
 * Compact "X/Y syntheses today" chip rendered in the user menu trigger row.
 * Hidden when the plan has no daily limit (e.g. admin) or while loading.
 */
export function QuotaChip() {
  const { data, isLoading } = useUsageMe();
  if (isLoading || !data) return null;
  const { syntheses } = data;
  if (syntheses.dailyLimit == null) return null;

  const remaining = syntheses.remaining ?? 0;
  const used = syntheses.todayCount;
  const limit = syntheses.dailyLimit;
  const exhausted = remaining <= 0;
  const low = !exhausted && remaining <= Math.max(1, Math.floor(limit / 5));

  return (
    <span
      data-testid="quota-chip"
      title={`Daily synthesis quota — resets ${new Date(syntheses.resetAtUtc).toLocaleString()}`}
      className={[
        "hidden md:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        exhausted
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : low
            ? "border-amber-400/40 bg-amber-100/50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "border-border bg-muted text-muted-foreground",
      ].join(" ")}
    >
      <Gauge className="h-3 w-3" />
      {used}/{limit} today
    </span>
  );
}

/**
 * Inline alert shown above the synthesize input when the user has used
 * their full daily quota. Calls out the exact reset time so users don't
 * have to dig into the user-menu chip to understand why submit is blocked.
 */
export function QuotaExhaustedAlert() {
  const { data } = useUsageMe();
  if (!data) return null;
  const { syntheses } = data;
  // Hide for unlimited plans (admin) and while still under the cap.
  if (syntheses.dailyLimit == null) return null;
  if ((syntheses.remaining ?? 0) > 0) return null;

  const reset = new Date(syntheses.resetAtUtc);
  return (
    <div
      role="alert"
      data-testid="quota-exhausted-alert"
      className="mb-4 rounded-md border border-amber-400/40 bg-amber-100/50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <div>
        <strong className="font-semibold">Daily synthesis limit reached.</strong>{" "}
        You've used all {syntheses.dailyLimit} of your daily syntheses. Your quota
        resets at <span className="font-medium">{reset.toLocaleString()}</span>{" "}
        (start of the next UTC day).
      </div>
    </div>
  );
}

/**
 * Site-wide banner shown when the global LLM spend cap is exhausted, so
 * users immediately understand why synthesis is unavailable.
 */
export function BudgetBanner() {
  const { data } = useUsageMe();
  if (!data?.budget?.exhausted) return null;
  const reset = new Date(data.budget.retryAfterUtc);
  return (
    <div
      role="alert"
      data-testid="budget-banner"
      className="border-b border-destructive/30 bg-destructive/10 text-destructive px-6 py-2 text-sm flex items-center gap-2"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span>
        Daily AI spend limit reached. New syntheses are paused until {reset.toLocaleString()}.
      </span>
    </div>
  );
}
