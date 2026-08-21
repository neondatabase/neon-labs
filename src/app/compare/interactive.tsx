"use client";

import { useState } from "react";
import { Copy, Check, Play, Loader2, ChevronDown, ChevronUp } from "lucide-react";

// The only client island on /compare: a copy-to-clipboard button. It copies the
// literal text it's given (already an absolute URL, resolved server-side from the
// request host) — everything else on the page is server-rendered.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

// Sample bodies for POST endpoints, so "Run" sends something real.
const SAMPLES: Record<string, unknown> = {
  "/api/compare/estimate": { supabase: { instance: "large", dbSizeGb: 8, avgCpuPct: 15, activity: "always_on", egressGb: 40 } },
};

type Endpoint = { method: string; path: string; desc: string };
type RunState = { loading?: boolean; status?: number; text?: string; open?: boolean };

// Interactive endpoint list. Paths are plain text (not links — a GET on the POST
// route would 404). Each row's Run button executes the call inline (GET as-is, POST
// with a sample body); once there's output, the same button toggles it collapsed.
export function ApiConsole({ endpoints, origin }: { endpoints: Endpoint[]; origin: string }) {
  const [state, setState] = useState<Record<string, RunState>>({});
  const onClick = async (e: Endpoint) => {
    const cur = state[e.path];
    if (cur && (cur.text !== undefined || cur.loading)) {
      setState((s) => ({ ...s, [e.path]: { ...cur, open: !cur.open } })); // already ran → toggle
      return;
    }
    setState((s) => ({ ...s, [e.path]: { loading: true, open: true } }));
    try {
      const init: RequestInit =
        e.method === "POST"
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(SAMPLES[e.path] ?? {}) }
          : {};
      const res = await fetch(origin + e.path, init);
      // Read as text first so a JSON-parse failure still preserves the real HTTP status.
      const raw = await res.text();
      let text = raw;
      if ((res.headers.get("content-type") || "").includes("json")) {
        try {
          text = JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          /* not valid JSON despite the header — show the raw body */
        }
      }
      if (text.length > 2000) text = text.slice(0, 2000) + "\n… (truncated)";
      setState((s) => ({ ...s, [e.path]: { loading: false, status: res.status, text, open: true } }));
    } catch (err) {
      setState((s) => ({ ...s, [e.path]: { loading: false, status: 0, text: err instanceof Error ? err.message : "request failed", open: true } }));
    }
  };
  return (
    <ul className="divide-y divide-border/60">
      {endpoints.map((e) => {
        const cur = state[e.path];
        const ran = cur && cur.text !== undefined;
        return (
          <li key={e.path} className="px-5 py-3">
            <div className="flex items-center gap-3">
              <span className={`w-11 shrink-0 rounded-[3px] px-1.5 py-0.5 text-center font-mono text-[10px] font-medium ${e.method === "POST" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {e.method}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-mono text-caption text-foreground">{e.path}</span>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{e.desc}{e.method === "POST" ? " · Run sends a sample payload." : ""}</p>
              </div>
              <CopyButton text={`${origin}${e.path}`} label="Copy URL" />
              <button
                type="button"
                onClick={() => onClick(e)}
                disabled={cur?.loading}
                className="inline-flex w-[74px] shrink-0 items-center justify-center gap-1.5 rounded-[4px] border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {cur?.loading ? <><Loader2 className="h-3 w-3 animate-spin" /> Running</>
                  : ran ? (cur.open ? <><ChevronUp className="h-3 w-3" /> Hide</> : <><ChevronDown className="h-3 w-3" /> Show</>)
                  : <><Play className="h-3 w-3" /> Run</>}
              </button>
            </div>
            {ran && cur.open && (
              <div className="mt-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {e.method} → <span className={cur.status && cur.status < 400 ? "text-primary" : "text-amber-500"}>{cur.status || "error"}</span>
                </div>
                <pre className="max-h-64 overflow-auto rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-foreground">{cur.text}</pre>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
