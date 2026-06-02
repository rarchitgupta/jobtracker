import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/lib/types";

const config: Record<JobStatus, { label: string; className: string }> = {
  applied:      { label: "Applied",      className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  phone_screen: { label: "Phone Screen", className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100" },
  technical:    { label: "Technical",    className: "bg-purple-100 text-purple-800 hover:bg-purple-100" },
  final:        { label: "Final Round",  className: "bg-orange-100 text-orange-800 hover:bg-orange-100" },
  offer:        { label: "Offer",        className: "bg-green-100 text-green-800 hover:bg-green-100" },
  rejected:     { label: "Rejected",     className: "bg-red-100 text-red-800 hover:bg-red-100" },
  ghosted:      { label: "Ghosted",      className: "bg-zinc-100 text-zinc-500 hover:bg-zinc-100" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, className } = config[status] ?? config.applied;
  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  );
}
