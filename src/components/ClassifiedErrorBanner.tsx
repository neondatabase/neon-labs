"use client";

import { useState } from "react";
import { AlertOctagon, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { neon } from "./ui";
import type {
  ClassifiedError,
  RecoveryActionId,
} from "@/lib/neon-error-codes";
import { Button } from "./ui/button";

/** Renders a structured Postgres/Neon error with explanation, ordered
    next steps, and optional one-click recovery actions the parent page
    knows how to execute. */
export function ClassifiedErrorBanner({
  classified,
  onAction,
}: {
  classified: ClassifiedError;
  onAction?: (id: RecoveryActionId, payload?: Record<string, unknown>) => Promise<void> | void;
}) {
  const [runningId, setRunningId] = useState<RecoveryActionId | null>(null);

  const tone =
    classified.severity === "warning"
      ? {
          border: "border-[#f59e0b]/40",
          bg: "bg-[#f59e0b]/[0.06]",
          text: "text-[#f59e0b]",
          icon: AlertTriangle,
        }
      : {
          border: "border-[#ef4444]/40",
          bg: "bg-[#ef4444]/[0.06]",
          text: "text-[#ef4444]",
          icon: AlertOctagon,
        };
  const Icon = tone.icon;

  return (
    <div className={`mt-4 rounded-[4px] border p-4 ${tone.border} ${tone.bg}`}>
      <div className="mb-3 flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-ui font-medium ${tone.text}`}>
            {classified.title}
            {classified.code && (
              <span className="ml-2 font-mono text-label opacity-70">
                · SQLSTATE {classified.code}
              </span>
            )}
          </p>
          <p className={`mt-1 text-caption ${neon.muted}`}>
            {classified.explanation}
          </p>
        </div>
      </div>

      {/* Next steps */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Next steps</p>
        <ol className="space-y-1.5 text-caption text-[#f3f4f6]">
          {classified.nextSteps.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Recovery actions */}
      {classified.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {classified.actions.map((a) => {
            const isOpenConsole = a.id === "open-neon-console";
            return (
              <Button size="lg"
                key={a.id}
                variant={a.id === "drop-orphan-slot" ? "destructive" : "outline"}
                disabled={runningId !== null}
                onClick={async () => {
                  if (!onAction) return;
                  setRunningId(a.id);
                  try {
                    await onAction(a.id, a.payload);
                  } finally {
                    setRunningId(null);
                  }
                }}
              >
                {runningId === a.id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    {a.label}
                    {isOpenConsole && <ExternalLink className="h-3 w-3" />}
                  </>
                )}
              </Button>
            );
          })}
        </div>
      )}

      {/* Raw message, collapsible */}
      <details className="mt-3">
        <summary className="cursor-pointer text-label text-[#9ca3af] hover:text-foreground">
          Show raw error
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-2 font-mono text-micro text-[#f3f4f6]">
          {classified.raw}
        </pre>
      </details>
    </div>
  );
}
