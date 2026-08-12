"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Terminal,
  Zap,
} from "lucide-react";
import { useAssessment } from "@/components/AssessmentProvider";
import { TargetProjectPicker } from "@/components/TargetProjectPicker";
import { PageHeader, neon, CopyToggleIcon } from "@/components/ui";
import {
  Notice,
  NoticeActions,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
} from "@/components/ui/notice";
import {
  getSourceOverride,
  getTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";
import type {
  DumpRestorePreflight,
  DumpRestoreResult,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NeonConfig {
  orgId: string | null;
  orgName: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  hasSourceConnection: boolean;
  hasTargetConnection: boolean;
}

export default function DumpRestorePage() {
  const { assessment } = useAssessment();
  const [cfg, setCfg] = useState<NeonConfig | null>(null);
  const [pre, setPre] = useState<DumpRestorePreflight | null>(null);
  const [result, setResult] = useState<DumpRestoreResult | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "preflighting" | "preflight-done" | "running" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [override, setOverride] = useState<TargetOverride | null>(null);
  const [sourceOverride, setSourceOverride] = useState<TargetOverride | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOverride(getTargetOverride());
    setSourceOverride(getSourceOverride());
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  // Send project ids only. The server resolves short-lived connection URIs.
  const targetBody = () => {
    const body: Record<string, string> = {};
    if (sourceOverride?.projectId)
      body.sourceProjectId = sourceOverride.projectId;
    if (override?.projectId) body.targetProjectId = override.projectId;
    return body;
  };

  async function runPreflight() {
    setPhase("preflighting");
    setError(null);
    try {
      const res = await fetch("/api/neon/dump-restore/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setPre(body);
      setPhase("preflight-done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preflight failed");
      setPhase("idle");
    }
  }

  async function runExecute() {
    if (!confirmRun) {
      setConfirmRun(true);
      return;
    }
    setPhase("running");
    setError(null);
    try {
      const res = await fetch("/api/neon/dump-restore/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setResult(body);
      setConfirmRun(false);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execute failed");
      setPhase("preflight-done");
    }
  }

  async function copyValue(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      /* ignore */
    }
  }

  /* Readiness counts projects picked in the app (stored as overrides), not
     just the env vars cfg reports. Gating on cfg alone made the pickers
     below unreachable, since they only render past this point. */
  const sourceReady = Boolean(
    sourceOverride?.projectId || cfg?.hasSourceConnection,
  );
  const targetReady = Boolean(
    override?.projectId || cfg?.hasTargetConnection,
  );

  const pickerRow = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#262727] bg-[#131414] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-caption">
        <TargetProjectPicker
          role="source"
          targetPgVersion={assessment?.sourceVersion ?? 14}
          onChange={(t) => {
            setSourceOverride(t);
            setPre(null);
            setResult(null);
            setPhase("idle");
          }}
        />
        <span className="text-[#00e599]">→</span>
        <TargetProjectPicker
          role="target"
          targetPgVersion={assessment?.targetVersion ?? 17}
          onChange={(t) => {
            setOverride(t);
            setPre(null);
            setResult(null);
            setPhase("idle");
          }}
        />
      </div>
      <span className="font-mono text-label text-[#9ca3af]">
        phase: {phase}
      </span>
    </div>
  );

  if (!sourceReady || !targetReady) {
    return (
      <div className={neon.page}>
        <div className={neon.pageContent}>
          <PageHeader
            title="pg_dump → pg_restore"
            subtitle="Generate the pg_dump pipeline, or run an in-app schema + data copy for small databases."
          />
          {pickerRow}
          <Notice tone="warning">
            <NoticeIcon>
              <AlertTriangle />
            </NoticeIcon>
            <NoticeBody>
              <NoticeTitle>
                {!sourceReady && !targetReady
                  ? "Pick a source and a target project"
                  : !sourceReady
                    ? "Pick a source project"
                    : "Pick a target project"}
              </NoticeTitle>
              <NoticeDescription>
                A dump and restore needs both sides. Choose them above and the
                app fetches their direct connection strings from the Neon API.
                You can also set NEON_SOURCE_CONNECTION_STRING and
                NEON_TARGET_CONNECTION_STRING in .env.local.
              </NoticeDescription>
              <NoticeActions>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/assess" />}
                >
                  Run an assessment first
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </NoticeActions>
            </NoticeBody>
          </Notice>
        </div>
      </div>
    );
  }

  return (
    <div className={neon.page}>
      <div className={neon.pageContent}>
        <PageHeader
          title="pg_dump → pg_restore"
          subtitle="Best for 10 GB – 200 GB databases with a planned maintenance window. Simple, well-understood, no replication slot."
        />

        {pickerRow}

        {/* Step 1: Preflight */}
        <Section
          step="01"
          title="Preflight"
          subtitle="Detect PG versions, table count, size, extensions, and whether target is empty"
          action={
            <Button size="lg"
              onClick={runPreflight}
              disabled={phase === "preflighting"}
              variant={pre ? "outline" : "white"}
            >
              {phase === "preflighting" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {pre ? "Re-check" : "Run preflight"}
                </>
              )}
            </Button>
          }
        >
          {pre && <PreflightDetails p={pre} />}
        </Section>

        {/* Step 2: Generated commands */}
        {pre && (
          <Section
            step="02"
            title="Recommended: run pg_dump locally"
            subtitle="Full pg_dump fidelity with parallel restore. Copy/paste into your terminal."
          >
            <div className="space-y-3">
              <CmdBlock
                label="1. Schema dump"
                cmd={pre.generatedCommands.schemaDump}
                k="schemaDump"
                copied={copied === "schemaDump"}
                onCopy={() => copyValue("schemaDump", pre.generatedCommands.schemaDump)}
              />
              <CmdBlock
                label="2. Data dump (4 parallel workers, custom format)"
                cmd={pre.generatedCommands.dataDump}
                k="dataDump"
                copied={copied === "dataDump"}
                onCopy={() => copyValue("dataDump", pre.generatedCommands.dataDump)}
              />
              <CmdBlock
                label="3. Restore schema"
                cmd={pre.generatedCommands.schemaRestore}
                k="schemaRestore"
                copied={copied === "schemaRestore"}
                onCopy={() =>
                  copyValue("schemaRestore", pre.generatedCommands.schemaRestore)
                }
              />
              <CmdBlock
                label="4. Restore data (4 parallel workers)"
                cmd={pre.generatedCommands.dataRestore}
                k="dataRestore"
                copied={copied === "dataRestore"}
                onCopy={() =>
                  copyValue("dataRestore", pre.generatedCommands.dataRestore)
                }
              />
              <details className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
                <summary className="cursor-pointer text-caption text-[#9ca3af] hover:text-foreground">
                  Single-shot pipeline (small databases only)
                </summary>
                <div className="mt-3">
                  <CmdBlock
                    label="Pipelined dump | restore"
                    cmd={pre.generatedCommands.pipelined}
                    k="pipelined"
                    copied={copied === "pipelined"}
                    onCopy={() =>
                      copyValue("pipelined", pre.generatedCommands.pipelined)
                    }
                  />
                </div>
              </details>
            </div>
          </Section>
        )}

        {/* Step 3: In-app execute */}
        {pre && (
          <Section
            step="03"
            title="Or run in-app (best for ≤ 1 GB databases)"
            subtitle="Schema introspection + per-table COPY via SQL. Convenient but slower than pg_dump for large data."
            danger
            action={
              <Button size="lg"
                onClick={runExecute}
                disabled={!pre.ok || phase === "running"}
                variant={confirmRun ? "destructive" : "white"}
              >
                {phase === "running" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running…
                  </>
                ) : confirmRun ? (
                  <>
                    <AlertOctagon className="h-3.5 w-3.5" />
                    Confirm, runs against live target
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    Run in-app dump-restore
                  </>
                )}
              </Button>
            }
          >
            <p className={`text-caption ${neon.muted}`}>
              Copies extensions, sequences, tables, indexes, then INSERTs rows
              in 500-row batches. Resets sequences to{" "}
              <span className="font-mono">max(col)</span> after. Idempotent
              via{" "}
              <span className="font-mono">ON CONFLICT DO NOTHING</span>.
            </p>
          </Section>
        )}

        {/* Step 4: Result */}
        {result && (
          <Section
            step="04"
            title="Migration complete"
            subtitle={`Took ${(result.totalDurationMs / 1000).toFixed(2)}s · ${result.totalRowsCopied.toLocaleString()} rows · ${(result.totalBytesEstimate / 1e6).toFixed(2)} MB source`}
          >
            <ResultDetails r={result} />
          </Section>
        )}

        {error && (
          <div className="mt-4 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-caption text-[#ef4444]">
            <span className="font-mono">error:</span> {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  subtitle,
  action,
  children,
  danger,
}: {
  step: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`mb-5 rounded-[4px] border p-5 ${
        danger
          ? "border-[#f59e0b]/40 bg-[#f59e0b]/[0.04]"
          : "border-[#262727] bg-[#131414]"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="tag text-[#00e599]">Step {step}</span>
          <h2 className={`${neon.h2} mt-1`}>{title}</h2>
          {subtitle && (
            <p className={`mt-1 text-caption tabular-nums text-pretty ${neon.muted}`}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

function PreflightDetails({ p }: { p: DumpRestorePreflight }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag mb-2">Source</p>
          <KV k="PG version" v={`PostgreSQL ${p.source.pgVersion}`} />
          <KV k="Database" v={p.source.database} />
          <KV k="Tables" v={p.source.tableCount.toString()} />
          <KV
            k="Size"
            v={`${(p.source.estimatedSizeBytes / 1e6).toFixed(2)} MB`}
          />
          <KV
            k="Extensions"
            v={p.source.extensions.length.toString()}
            sub={p.source.extensions.slice(0, 4).join(", ")}
          />
        </div>
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag mb-2">Target</p>
          <KV k="PG version" v={`PostgreSQL ${p.target.pgVersion}`} />
          <KV k="Database" v={p.target.database} />
          <KV
            k="Is empty"
            v={p.target.isEmpty ? "yes" : `no (${p.target.existingTableCount} tables)`}
            tone={p.target.isEmpty ? "ok" : "warn"}
          />
        </div>
      </div>
      <div className="space-y-2">
        {p.blockers.map((b, i) => (
          <Banner key={i} kind="blocker" text={b} />
        ))}
        {p.warnings.map((w, i) => (
          <Banner key={i} kind="warning" text={w} />
        ))}
        {p.ok && p.blockers.length === 0 && p.warnings.length === 0 && (
          <Banner kind="ok" text="Ready to run dump-restore." />
        )}
      </div>
    </div>
  );
}

function ResultDetails({ r }: { r: DumpRestoreResult }) {
  const mismatched = r.rowCounts.filter((rc) => !rc.match);
  return (
    <div className="space-y-4">
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Timeline</p>
        <div className="space-y-1.5">
          {r.steps.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 text-caption"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className={
                    s.status === "ok"
                      ? "text-[#00e599]"
                      : s.status === "failed"
                        ? "text-[#ef4444]"
                        : "text-[#9ca3af]"
                  }
                >
                  {s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "·"}
                </span>
                <div className="min-w-0">
                  <span className="text-foreground">{s.label}</span>
                  {s.detail && (
                    <span className="ml-2 font-mono text-label text-[#9ca3af]">
                      {s.detail}
                    </span>
                  )}
                </div>
              </div>
              <span className="font-mono text-label tnum text-[#9ca3af]">
                {s.durationMs ?? 0}ms
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Row count verification</p>
        <div className="grid gap-1 text-label">
          {r.rowCounts.map((rc) => (
            <div
              key={rc.table}
              className="flex items-center justify-between font-mono"
            >
              <span className="text-foreground">{rc.table}</span>
              <span className="flex items-center gap-2">
                <span className="text-[#9ca3af]">
                  {rc.sourceRows.toLocaleString()} → {rc.targetRows.toLocaleString()}
                </span>
                <span className={rc.match ? "text-[#00e599]" : "text-[#f59e0b]"}>
                  {rc.match ? "✓" : `Δ${rc.delta}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {mismatched.length > 0 && (
        <Banner
          kind="warning"
          text={`${mismatched.length} table(s) have row count mismatches, re-run or inspect`}
        />
      )}
    </div>
  );
}

function CmdBlock({
  label,
  cmd,
  k,
  copied,
  onCopy,
}: {
  label: string;
  cmd: string;
  k: string;
  copied: boolean;
  onCopy: () => void;
}) {
  void k;
  return (
    <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d]">
      <div className="flex items-center justify-between border-b border-[#262727] px-3 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-3 w-3 text-[#00e599]" />
          <span className="text-caption text-foreground">{label}</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          className="relative flex min-h-[32px] items-center gap-1.5 rounded-[4px] px-2 py-1.5 text-label text-[#9ca3af] transition-colors duration-150 ease-out before:absolute before:-inset-1 before:content-[''] hover:bg-[#1a1b1b] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]"
        >
          <CopyToggleIcon copied={copied} className="h-3.5 w-3.5" />
          <span className="w-[42px] text-left">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-label text-[#f3f4f6]">
        {cmd}
      </pre>
    </div>
  );
}

function KV({
  k,
  v,
  tone,
  sub,
}: {
  k: string;
  v: string;
  tone?: "ok" | "warn" | "bad";
  sub?: string;
}) {
  const color =
    tone === "ok"
      ? "text-[#00e599]"
      : tone === "warn"
        ? "text-[#f59e0b]"
        : tone === "bad"
          ? "text-[#ef4444]"
          : "text-foreground";
  return (
    <div className="border-b border-[#262727]/60 py-1.5 text-caption last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-[#9ca3af]">{k}</span>
        <span className={`font-mono ${color}`}>{v}</span>
      </div>
      {sub && (
        <p className="mt-0.5 truncate font-mono text-micro text-[#9ca3af]">
          {sub}
        </p>
      )}
    </div>
  );
}

function Banner({
  kind,
  text,
}: {
  kind: "ok" | "warning" | "blocker";
  text: string;
}) {
  const styles = {
    ok: "border-[#00e599]/40 bg-[#00e599]/[0.08] text-[#00e599]",
    warning: "border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] text-[#f59e0b]",
    blocker: "border-[#ef4444]/40 bg-[#ef4444]/[0.08] text-[#ef4444]",
  };
  const Icon = kind === "ok" ? CheckCircle2 : kind === "warning" ? AlertTriangle : AlertOctagon;
  return (
    <div
      className={`flex items-start gap-2 rounded-[4px] border px-3 py-2 text-caption ${styles[kind]}`}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </div>
  );
}
