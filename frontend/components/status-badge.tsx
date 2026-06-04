import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

const config: Record<JobStatus, { label: string; className: string }> = {
  shortlisted: { label: "Shortlisted", className: "bg-violet-100 text-violet-800 hover:bg-violet-100" },
  applied:     { label: "Applied",     className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  interview:   { label: "Interview",   className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  offer:       { label: "Offer",       className: "bg-green-100 text-green-800 hover:bg-green-100" },
  rejected:    { label: "Rejected",    className: "bg-red-100 text-red-800 hover:bg-red-100" },
  ghosted:     { label: "Ghosted",     className: "bg-zinc-100 text-zinc-500 hover:bg-zinc-100" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = config[status] ?? config.applied;
  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  );
}
