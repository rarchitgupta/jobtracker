import {
  Bookmark, Send, Phone, PartyPopper, XCircle, CircleDashed,
} from "lucide-react";
import type { JobStatus } from "./types";

export const COLUMNS: Record<JobStatus, { title: string; icon: React.ReactNode; accent: string }> = {
  shortlisted: { title: "Shortlisted", accent: "text-violet-500", icon: <Bookmark     className="size-3.5" /> },
  applied:     { title: "Applied",     accent: "text-blue-500",   icon: <Send         className="size-3.5" /> },
  interview:   { title: "Interview",   accent: "text-yellow-500", icon: <Phone        className="size-3.5" /> },
  offer:       { title: "Offer",       accent: "text-green-500",  icon: <PartyPopper  className="size-3.5" /> },
  rejected:    { title: "Rejected",    accent: "text-red-400",    icon: <XCircle      className="size-3.5" /> },
  ghosted:     { title: "Ghosted",     accent: "text-zinc-400",   icon: <CircleDashed className="size-3.5" /> },
};
