"use client";

import { useState } from "react";
import { Copy, CheckCircle2, ExternalLink } from "lucide-react";

interface Props {
  url: string;
}

export function JobLink({ url }: Props) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const display = url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground max-w-full">
      <p className="min-w-0 flex-1 truncate font-mono">{display}</p>

      <button
        onClick={copy}
        title="Copy link"
        className="shrink-0 rounded p-0.5 transition-colors hover:text-foreground"
      >
        {copied ? (
          <CheckCircle2 className="size-3.5 text-green-500" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open job post"
        className="shrink-0 rounded p-0.5 transition-colors hover:text-foreground"
      >
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
