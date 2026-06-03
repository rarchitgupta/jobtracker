export type JobStatus =
  | "shortlisted"
  | "applied"
  | "phone_screen"
  | "technical"
  | "final"
  | "offer"
  | "rejected"
  | "ghosted";

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string | null;
  domain: string | null;
  source: string;
  status: JobStatus;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}
