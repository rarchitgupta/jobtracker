"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { ExternalLink, CheckCircle2 } from "lucide-react";
import {
  Kanban, KanbanBoard, KanbanColumn, KanbanColumnContent,
  KanbanItem, KanbanItemHandle, KanbanOverlay,
} from "@/components/reui/kanban";
import { Frame, FrameHeader, FrameTitle } from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { getJobs, updateJob } from "@/lib/api";
import { STATUS_ORDER, STATUS_SET } from "@/lib/jobs";
import { COLUMNS } from "@/lib/job-columns";
import { JobDialog } from "@/components/job-dialog";
import type { Job, JobStatus } from "@/lib/types";

const EMPTY_COLUMNS: Record<string, Job[]> = Object.fromEntries(STATUS_ORDER.map(s => [s, []]));

function jobsToColumns(jobs: Job[]): Record<string, Job[]> {
  const cols: Record<string, Job[]> = Object.fromEntries(STATUS_ORDER.map(s => [s, []]));
  for (const job of jobs) {
    const col = STATUS_SET.has(job.status) ? job.status : "applied";
    cols[col].push(job);
  }
  return cols;
}

// ─── Board ───────────────────────────────────────────────────────────────────

export function JobsKanban() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Local override during drag only — null at rest (server data drives the board)
  const [localColumns, setLocalColumns] = useState<Record<string, Job[]> | null>(null);

  // Debounce timers — one per job; prevents multi-firing during drag hover
  const pendingMutations = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Cleanup pending timers on unmount
  useEffect(() => {
    const timers = pendingMutations.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  const { data: jobs, isLoading } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const token = await getToken();
      return getJobs(token!);
    },
    refetchInterval: 30_000,
  });

  // Columns are DERIVED from the React Query cache — no duplicate state
  const serverColumns = useMemo(
    () => (jobs ? jobsToColumns(jobs) : EMPTY_COLUMNS),
    [jobs],
  );
  const columns = localColumns ?? serverColumns;

  const mutation = useMutation({
    mutationFn: async ({ jobId, status }: { jobId: string; status: string }) => {
      const token = await getToken();
      return updateJob(token!, jobId, { status });
    },
    onMutate: async ({ jobId, status }) => {
      await queryClient.cancelQueries({ queryKey: ["jobs"] });
      const previous = queryClient.getQueryData<Job[]>(["jobs"]);
      queryClient.setQueryData<Job[]>(["jobs"], old =>
        old?.map(j => j.id === jobId ? { ...j, status: status as JobStatus } : j) ?? [],
      );
      return { previous };
    },
    onSuccess: () => setLocalColumns(null),
    onError: (_, __, context) => {
      queryClient.setQueryData(["jobs"], context?.previous);
      setLocalColumns(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  function moveJob(jobId: string, newStatus: JobStatus) {
    mutation.mutate({ jobId, status: newStatus });
    setSelectedJob(prev => prev?.id === jobId ? { ...prev, status: newStatus } : prev);
  }

  function handleValueChange(newColumns: Record<string, Job[]>) {
    setLocalColumns(newColumns);
    for (const [colId, colJobs] of Object.entries(newColumns)) {
      for (const job of colJobs) {
        if (job.status !== colId) {
          clearTimeout(pendingMutations.current[job.id]);
          const target = colId;
          pendingMutations.current[job.id] = setTimeout(
            () => mutation.mutate({ jobId: job.id, status: target }),
            300,
          );
        }
      }
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        Loading jobs…
      </div>
    );
  }

  return (
    <>
      <Kanban
        value={columns}
        onValueChange={handleValueChange}
        getItemValue={(job) => job.id}
        className="h-full"
      >
        <KanbanBoard className="grid-cols-6 gap-3 h-full min-w-[860px]">
          {STATUS_ORDER.map((status) => {
            const col = COLUMNS[status];
            const colJobs = columns[status] ?? [];
            return (
              <KanbanColumn key={status} value={status} className="h-full">
                <Frame spacing="sm" className="h-full flex flex-col overflow-hidden">
                  <FrameHeader className="flex flex-row items-center gap-2 shrink-0">
                    <span className={col.accent}>{col.icon}</span>
                    <FrameTitle className="text-xs truncate">{col.title}</FrameTitle>
                    <Badge variant="outline" size="sm" className="ml-auto shrink-0 tabular-nums text-xs">
                      {colJobs.length}
                    </Badge>
                  </FrameHeader>
                  <KanbanColumnContent
                    value={status}
                    className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto p-0.5 pb-2"
                  >
                    {colJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        onOpen={() => setSelectedJob(job)}
                      />
                    ))}
                  </KanbanColumnContent>
                </Frame>
              </KanbanColumn>
            );
          })}
        </KanbanBoard>
        <KanbanOverlay className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50/50" />
      </Kanban>

      <JobDialog
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
        onStatusChange={(s) => selectedJob && moveJob(selectedJob.id, s)}
      />
    </>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function JobCard({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const card = (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border bg-white p-3 text-left shadow-xs transition-shadow hover:shadow-sm group/card cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {job.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.company}</p>
        </div>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${job.title} at ${job.company}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/card:opacity-100 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {job.confirmed && (
          <Badge variant="success-light" size="sm" className="gap-1">
            <CheckCircle2 className="size-2.5" />
            Confirmed
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDate(job.created_at)}
        </span>
      </div>
    </button>
  );

  return (
    <KanbanItem value={job.id}>
      <KanbanItemHandle>{card}</KanbanItemHandle>
    </KanbanItem>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
