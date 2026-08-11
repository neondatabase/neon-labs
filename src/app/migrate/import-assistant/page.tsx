"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useAssessment } from "@/components/AssessmentProvider";
import { TargetProjectPicker } from "@/components/TargetProjectPicker";
import { PageHeader, neon } from "@/components/ui";
import {
  Notice,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
} from "@/components/ui/notice";
import {
  getTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";
import type { ImportAssistantStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NeonConfig {
  orgId: string | null;
  orgName: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  hasTargetConnection: boolean;
}

export default function ImportAssistantPage() {
  const { assessment } = useAssessment();
  const [cfg, setCfg] = useState<NeonConfig | null>(null);
  const [override, setOverride] = useState<TargetOverride | null>(null);
  const [status, setStatus] = useState<ImportAssistantStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [autopoll, setAutopoll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverride(getTargetOverride());
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  const fetchStatus = useCallback(async () => {
    setPolling(true);
    setError(null);
    try {
      const res = await fetch("/api/neon/import-assistant/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetConnectionString: override?.connectionUri,
          projectId: override?.projectId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setStatus(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status failed");
    } finally {
      setPolling(false);
    }
  }, [override]);

  useEffect(() => {
    if (!autopoll) return;
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [autopoll, fetchStatus]);

  const projectId = override?.projectId ?? cfg?.targetProjectId;
  const consoleUrl = projectId
    ? `https://console.neon.tech/app/projects/${projectId}/import`
    : null;

  /* Readiness counts a project picked in the app (stored as an override), not
     just the env var cfg reports. Gating on cfg alone made the picker below
     unreachable, since it only renders past this point. This flow needs no
     source: you enter those credentials in the Neon Console. */
  const targetReady = Boolean(
    override?.connectionUri || cfg?.hasTargetConnection,
  );

  const pickerRow = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#262727] bg-[#131414] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-caption">
        <TargetProjectPicker
          role="target"
          targetPgVersion={assessment?.targetVersion ?? 17}
          onChange={(t) => {
            setOverride(t);
            setStatus(null);
          }}
        />
      </div>
    </div>
  );

  if (!targetReady) {
    return (
      <div className={neon.page}>
        <div className={neon.pageContent}>
          <PageHeader
            title="Import Data Assistant"
            subtitle="Neon Console's managed import, pick a target project and we'll hand off to the import flow."
          />
          {pickerRow}
          <Notice tone="warning">
            <NoticeIcon>
              <AlertTriangle />
            </NoticeIcon>
            <NoticeBody>
              <NoticeTitle>Pick a target project</NoticeTitle>
              <NoticeDescription>
                Choose the Neon project to import into above, or set
                NEON_TARGET_CONNECTION_STRING in .env.local. You'll enter the
                source credentials inside the Neon Console.
              </NoticeDescription>
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
          title="Import Data Assistant"
          subtitle="Recommended for databases under 10 GB. Neon copies your data via its managed import, no CLI required."
        />

        {pickerRow}

        {/* Step 1: Open Console */}
        <section className="mb-5 rounded-[4px] border border-[#262727] bg-[#131414] p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <span className="tag text-[#00e599]">Step 01</span>
              <h2 className={`${neon.h2} mt-1`}>Start the import in Neon Console</h2>
              <p className={`mt-1 text-caption ${neon.muted}`}>
                The Import Data Assistant runs inside the Neon Console with a
                managed UI. We hand off here, your source credentials never
                leave the Console once you enter them.
              </p>
            </div>
            {consoleUrl && (
              <a
                href={consoleUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-[18px] py-2 text-ui font-medium text-black transition-[scale,background-color,border-color,color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d] hover:bg-[#f3f4f6]"
              >
                <Upload className="h-3.5 w-3.5" />
                Open Import Assistant
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <ol className="mt-4 grid gap-2 text-caption text-[#f3f4f6] sm:grid-cols-2">
            <li className="flex gap-2">
              <span className="font-mono text-[#00e599]">01</span>
              Click "Open Import Assistant" above
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[#00e599]">02</span>
              Paste source connection string when prompted
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[#00e599]">03</span>
              Pick which databases to migrate
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[#00e599]">04</span>
              Start the import, return here to watch progress
            </li>
          </ol>
        </section>

        {/* Step 2: Live status */}
        <section className="mb-5 rounded-[4px] border border-[#262727] bg-[#131414] p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="tag text-[#00e599]">Step 02</span>
              <h2 className={`${neon.h2} mt-1`}>Watch target fill in</h2>
              <p className={`mt-1 text-caption ${neon.muted}`}>
                Polls{" "}
                <span className="font-mono">pg_class.reltuples</span> on the
                target every 5s to detect tables and approximate row counts.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="lg" variant="ghost" onClick={fetchStatus}>
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button size="lg"
                variant={autopoll ? "destructive" : "outline"}
                onClick={() => setAutopoll((a) => !a)}
              >
                {autopoll ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Auto-polling…
                  </>
                ) : (
                  "Start auto-poll"
                )}
              </Button>
            </div>
          </div>

          {!status && !polling && (
            <p className={`text-caption ${neon.muted}`}>
              Click Refresh to read the target.
            </p>
          )}

          {status && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Stat
                  icon={Database}
                  label="Tables on target"
                  value={status.tableCount.toString()}
                  tone={status.importStarted ? "ok" : "muted"}
                />
                <Stat
                  icon={Upload}
                  label="Approx. rows"
                  value={status.totalRows.toLocaleString()}
                  tone={status.importComplete ? "ok" : "warn"}
                />
                <Stat
                  icon={CheckCircle2}
                  label="State"
                  value={
                    status.importComplete
                      ? "data present"
                      : status.importStarted
                        ? "schema only"
                        : "empty"
                  }
                  tone={status.importComplete ? "ok" : "muted"}
                />
              </div>
              <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
                <p className="tag mb-2">Per-table approximate rows</p>
                <div className="grid gap-1 text-label">
                  {status.rowCountsByTable.length === 0 ? (
                    <p className={neon.muted}>
                      No tables yet, import hasn't started or schema hasn't loaded.
                    </p>
                  ) : (
                    status.rowCountsByTable.map((r) => (
                      <div
                        key={r.table}
                        className="flex items-center justify-between font-mono"
                      >
                        <span className="text-foreground">{r.table}</span>
                        <span className="text-[#f3f4f6]">
                          {r.rows.toLocaleString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <p className="mt-3 text-label text-[#9ca3af]">
                Row counts are PG's planner estimates (
                <span className="font-mono">pg_class.reltuples</span>), exact
                up to the last <span className="font-mono">VACUUM ANALYZE</span>.
                For exact counts run <span className="font-mono">SELECT count(*)</span>{" "}
                in the Neon SQL editor.
              </p>
            </>
          )}

          {error && (
            <div className="mt-3 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-caption text-[#ef4444]">
              <span className="font-mono">error:</span> {error}
            </div>
          )}
        </section>

        <p className="text-label text-[#9ca3af]">
          Neon docs:{" "}
          <a
            href="https://neon.com/docs/import/import-data-assistant"
            target="_blank"
            rel="noreferrer"
            className="text-[#00e599] hover:underline"
          >
            Import Data Assistant
          </a>
        </p>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  tone: "ok" | "warn" | "muted";
}) {
  const color = tone === "ok" ? "#00e599" : tone === "warn" ? "#f59e0b" : "#9ca3af";
  return (
    <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" style={{ color }} />
        <span className="tag">{label}</span>
      </div>
      <p
        className="mt-1.5 text-heading font-medium tracking-[-0.3px] tnum"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}
