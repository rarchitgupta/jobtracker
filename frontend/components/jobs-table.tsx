"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { getJobs } from "@/lib/api";
import { useJobsStore } from "@/lib/store";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Job, JobStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all",         label: "All" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "applied",     label: "Applied" },
  { value: "interview",   label: "Interview" },
  { value: "offer",       label: "Offer" },
  { value: "rejected",    label: "Rejected" },
  { value: "ghosted",     label: "Ghosted" },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function JobsTable() {
  const { statusFilter, setStatusFilter } = useJobsStore();
  const { getToken } = useAuth();

  const { data: jobs, isLoading, isError } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const token = await getToken();
      return getJobs(token!);
    },
    refetchInterval: 30_000,
  });

  const filtered = jobs?.filter(
    (j) => statusFilter === "all" || j.status === statusFilter
  );

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              statusFilter === value
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
            }`}
          >
            {label}
            {value !== "all" && jobs && (
              <span className="ml-1 text-xs opacity-60">
                {jobs.filter((j) => j.status === value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>Applied</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {isError && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-red-500 py-10">
                  Could not connect to the backend.
                </TableCell>
              </TableRow>
            )}
            {filtered?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  No jobs tracked yet.
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((job: Job) => (
              <TableRow key={job.id}>
                <TableCell className="font-medium">
                  {job.url ? (
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {job.title}
                    </a>
                  ) : (
                    job.title
                  )}
                </TableCell>
                <TableCell>{job.company}</TableCell>
                <TableCell>
                  <StatusBadge status={job.status} />
                </TableCell>
                <TableCell>
                  <span className={job.confirmed ? "text-green-600" : "text-zinc-400"}>
                    {job.confirmed ? "Yes" : "No"}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(job.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
