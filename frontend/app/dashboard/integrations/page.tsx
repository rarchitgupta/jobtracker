"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface GmailStatus {
  connected: boolean;
  email: string | null;
}

export default function IntegrationsPage() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("gmail") === "connected") {
      setBanner("Gmail connected successfully.");
      // clean the query param without a page reload
      window.history.replaceState({}, "", "/dashboard/integrations");
    }
  }, [searchParams]);

  useEffect(() => {
    async function fetchStatus() {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/auth/gmail/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setGmail(await res.json());
      setLoading(false);
    }
    fetchStatus();
  }, [getToken]);

  async function handleConnect() {
    const token = await getToken();
    const res = await fetch(`${API_BASE}/auth/gmail/start`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { url } = await res.json();
    window.location.href = url;
  }

  async function handleDisconnect() {
    const token = await getToken();
    await fetch(`${API_BASE}/auth/gmail`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setGmail({ connected: false, email: null });
  }

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect external services to enrich your job tracking.
        </p>
      </div>

      {banner && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {banner}
        </div>
      )}

      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg border bg-white shadow-sm">
              <GmailIcon />
            </div>
            <div>
              <p className="text-sm font-medium">Gmail</p>
              {loading ? (
                <p className="text-xs text-muted-foreground">Checking…</p>
              ) : gmail?.connected ? (
                <p className="text-xs text-muted-foreground">{gmail.email}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Not connected</p>
              )}
            </div>
          </div>

          {!loading && (
            gmail?.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Connected
                </span>
                <button
                  onClick={handleDisconnect}
                  className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                className="bg-zinc-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-zinc-700 transition-colors"
              >
                Connect
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function GmailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5">
      <path
        d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"
        fill="#EA4335"
      />
    </svg>
  );
}
