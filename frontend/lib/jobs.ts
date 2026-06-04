import type { JobStatus } from "./types";

export const STATUS_ORDER: JobStatus[] = [
  "shortlisted",
  "applied",
  "interview",
  "offer",
  "rejected",
  "ghosted",
];

// O(1) membership check — avoids .includes() inside loops
export const STATUS_SET = new Set<string>(STATUS_ORDER);

export const STATUS_LABELS: Record<JobStatus, string> = {
  shortlisted: "Shortlisted",
  applied:     "Applied",
  interview:   "Interview",
  offer:       "Offer",
  rejected:    "Rejected",
  ghosted:     "Ghosted",
};
