import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ConsensusBadgeProps {
  status: string;
  compact?: boolean;
}

export function ConsensusBadge({ status, compact }: ConsensusBadgeProps) {
  const config: Record<string, { label: string; className: string }> = {
    "well-established": {
      label: compact ? "Established" : "Well-Established",
      className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
    },
    "contested": {
      label: "Contested",
      className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-700",
    },
    "preliminary": {
      label: "Preliminary",
      className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
    },
    "insufficient evidence": {
      label: compact ? "Insufficient" : "Insufficient Evidence",
      className: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600",
    },
  };

  const c = config[status.toLowerCase()] ?? config["preliminary"];

  return (
    <Badge
      variant="outline"
      data-testid={`badge-consensus-${status}`}
      className={cn("text-xs font-medium whitespace-nowrap shrink-0", c.className)}
    >
      {c.label}
    </Badge>
  );
}

interface EvidenceQualityBadgeProps {
  quality: string;
}

export function EvidenceQualityBadge({ quality }: EvidenceQualityBadgeProps) {
  const config: Record<string, string> = {
    A: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300",
    B: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300",
    C: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300",
    D: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300",
  };

  return (
    <Badge
      variant="outline"
      data-testid={`badge-quality-${quality}`}
      className={cn("text-xs font-bold shrink-0", config[quality] ?? config.C)}
    >
      Grade {quality}
    </Badge>
  );
}

interface ReplicationBadgeProps {
  status: string;
}

export function ReplicationBadge({ status }: ReplicationBadgeProps) {
  const config: Record<string, { label: string; className: string }> = {
    confirmed: { label: "Confirmed", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300" },
    failed: { label: "Failed", className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300" },
    unverified: { label: "Unverified", className: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-400" },
    partial: { label: "Partial", className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300" },
  };

  const c = config[status.toLowerCase()] ?? config.unverified;

  return (
    <Badge
      variant="outline"
      data-testid={`badge-replication-${status}`}
      className={cn("text-xs font-medium", c.className)}
    >
      {c.label}
    </Badge>
  );
}
