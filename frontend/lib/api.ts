import type { Job } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authFetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  return res;
}

export async function getJobs(token: string): Promise<Job[]> {
  const res = await authFetch(`${API_BASE}/jobs/`, token, { cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function createJob(
  token: string,
  payload: { title: string; company: string; url?: string }
): Promise<{ job: Job; duplicate: boolean }> {
  const res = await authFetch(`${API_BASE}/jobs/`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const job = await res.json();
  return { job, duplicate: job.duplicate ?? false };
}
