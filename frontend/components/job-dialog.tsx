"use client";

import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { JobLink } from "@/components/job-link";
import { COLUMNS } from "@/lib/job-columns";
import { STATUS_ORDER, STATUS_LABELS } from "@/lib/jobs";
import type { Job, JobStatus } from "@/lib/types";

interface Props {
  job: Job | null;
  onClose: () => void;
  onStatusChange: (status: JobStatus) => void;
}

export function JobDialog({ job, onClose, onStatusChange }: Props) {
  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p-6 min-w-2xl">
        {job && (
          <>
            <DialogHeader className="space-y-1 pr-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {job.company}
              </p>
              <DialogTitle className="text-2xl font-semibold leading-snug">
                {job.title}
              </DialogTitle>
            </DialogHeader>

            {job.url && <JobLink url={job.url} />}

            <div className="space-y-5 pt-2">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Status
                </label>
                <Select
                  value={job.status}
                  onValueChange={(v) => onStatusChange(v as JobStatus)}
                >
                  <SelectTrigger style={{ width: "100%" }}>
                    {/* Render current selection with icon manually — avoids SelectValue width quirks */}
                    <span className="flex flex-1 items-center gap-2 text-sm">
                      <span
                        className={COLUMNS[job.status as JobStatus]?.accent}
                      >
                        {COLUMNS[job.status as JobStatus]?.icon}
                      </span>
                      {STATUS_LABELS[job.status as JobStatus]}
                    </span>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        <span className="flex items-center gap-2">
                          <span className={COLUMNS[s].accent}>
                            {COLUMNS[s].icon}
                          </span>
                          {STATUS_LABELS[s]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
                <span>Tracked {formatDate(job.created_at)}</span>
                {job.confirmed && (
                  <span className="flex items-center gap-1.5 font-medium text-green-600">
                    <CheckCircle2 className="size-3.5" />
                    Confirmed via email
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
