import { create } from "zustand";
import type { JobStatus } from "./types";

interface JobsState {
  statusFilter: JobStatus | "all";
  setStatusFilter: (status: JobStatus | "all") => void;
}

export const useJobsStore = create<JobsState>((set) => ({
  statusFilter: "all",
  setStatusFilter: (status) => set({ statusFilter: status }),
}));
