"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Loader2,
  PlayCircle,
  Power,
  RefreshCw,
  Repeat,
  Settings,
  Terminal,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { useAssessment } from "@/components/AssessmentProvider";
import { NeonSettingsModal } from "@/components/NeonSettingsModal";
import { TargetProjectPicker } from "@/components/TargetProjectPicker";
import { ClassifiedErrorBanner } from "@/components/ClassifiedErrorBanner";
import { PageHeader, neon } from "@/components/ui";
import {
  Notice,
  NoticeActions,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
} from "@/components/ui/notice";
import type {
  ClassifiedError,
  RecoveryActionId,
} from "@/lib/neon-error-codes";
import {
  getNeonSettings,
  getSourceOverride,
  getTargetOverride,
  hasNeonCredentials,
  type TargetOverride,
} from "@/lib/neon-settings";
import type {
  AnalyzeTargetResult,
  CutoverPreflight,
  CutoverResult,
  ReplicationMonitor,
  ReplicationPreflight,
  ReplicationSetupResult,
  ReplicationStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NeonConfig {
  orgName: string | null;
  orgId: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  hasSourceConnection: boolean;
  hasTargetConnection: boolean;
}

type Phase =
  | "idle"
  | "preflighting"
  | "preflight-done"
  | "enabling"
  | "setting-up"
  | "monitoring"
  | "cutover-preflight"
  | "cutover-ready"
  | "cutting-over"
  | "cutover-complete"
  | "analyzing-target"
  | "tearing-down";

export default function ReplicationPage() {
  const { assessment } = useAssessment();
  const [cfg, setCfg] = useState<NeonConfig | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preflight, setPreflight] = useState<ReplicationPreflight | null>(null);
  const [setup, setSetup] = useState<ReplicationSetupResult | null>(null);
  const [status, setStatus] = useState<ReplicationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classifiedError, setClassifiedError] = useState<ClassifiedError | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [cutoverPre, setCutoverPre] = useState<CutoverPreflight | null>(null);
  const [cutoverResult, setCutoverResult] = useState<CutoverResult | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeTargetResult | null>(
    null,
  );
  const [confirmCutover, setConfirmCutover] = useState(false);
  const [copiedConn, setCopiedConn] = useState(false);
  const [monitor, setMonitor] = useState<ReplicationMonitor | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorAutopoll, setMonitorAutopoll] = useState(false);
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const [targetOverride, setTargetOverrideState] = useState<TargetOverride | null>(null);
  const [sourceOverride, setSourceOverrideState] = useState<TargetOverride | null>(null);

  useEffect(() => {
    setTargetOverrideState(getTargetOverride());
    setSourceOverrideState(getSourceOverride());
  }, []);

  /* The source can come from an in-app pick or the env default, and the
     Neon API calls below need its project id either way. */
  const sourceProjectId = sourceOverride?.projectId ?? cfg?.sourceProjectId ?? null;

  // Body shape every replication route accepts: pass both connection strings
  // when the user has picked overrides, otherwise the server falls back to env.
  const targetBody = () => {
    const body: Record<string, string> = {};
    if (sourceOverride?.connectionUri)
      body.sourceConnectionString = sourceOverride.connectionUri;
    if (targetOverride?.connectionUri)
      body.targetConnectionString = targetOverride.connectionUri;
    if (sourceOverride?.projectId) body.sourceProjectId = sourceOverride.projectId;
    if (targetOverride?.projectId) body.targetProjectId = targetOverride.projectId;
    return body;
  };

  /** Extract structured error from a response body and surface both
      raw + classified state. Returns the message to throw for normal flow. */
  function handleApiError(body: unknown, fallback: string): string {
    const obj = body as { error?: string; classified?: ClassifiedError } | null;
    const raw = obj?.error ?? fallback;
    if (obj?.classified) setClassifiedError(obj.classified);
    else setClassifiedError(null);
    return raw;
  }

  useEffect(() => {
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  useEffect(() => {
    setHasKey(hasNeonCredentials());
  }, [settingsOpen]);

  // Auto-poll status during monitoring phase
  const pollStatus = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (targetOverride?.connectionUri)
        qs.set("target", targetOverride.connectionUri);
      if (sourceOverride?.connectionUri)
        qs.set("source", sourceOverride.connectionUri);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      const res = await fetch(`/api/neon/replication/status${q}`);
      const body = await res.json();
      if (res.ok) setStatus(body);
    } catch {
      /* swallow polling errors */
    }
  }, [sourceOverride, targetOverride]);

  useEffect(() => {
    if (phase !== "monitoring") return;
    pollStatus();
    const i = setInterval(pollStatus, 3000);
    return () => clearInterval(i);
  }, [phase, pollStatus]);

  async function runPreflight() {
    setPhase("preflighting");
    setError(null);
    try {
      const res = await fetch("/api/neon/replication/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setPreflight(body);
      setPhase("preflight-done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preflight failed");
      setPhase("idle");
    }
  }

  async function enableSourceLogicalReplication() {
    if (!confirmEnable) {
      setConfirmEnable(true);
      return;
    }
    setPhase("enabling");
    setError(null);
    try {
      const { apiKey } = getNeonSettings();
      const res = await fetch("/api/neon/replication/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          projectId: sourceProjectId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      // Re-preflight after enabling
      setConfirmEnable(false);
      await new Promise((r) => setTimeout(r, 4000)); // wait for compute restart
      await runPreflight();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enable failed");
      setPhase("preflight-done");
    }
  }

  async function runSetup() {
    setPhase("setting-up");
    setError(null);
    try {
      const res = await fetch("/api/neon/replication/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setSetup(body);
      setPhase("monitoring");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setPhase("preflight-done");
    }
  }

  async function runTeardown() {
    if (!confirm("Drop the subscription on the target and the publication on the source?"))
      return;
    setPhase("tearing-down");
    setError(null);
    try {
      const res = await fetch("/api/neon/replication/teardown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setSetup(null);
      setStatus(null);
      setCutoverPre(null);
      setCutoverResult(null);
      setPhase("idle");
      setPreflight(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teardown failed");
      setPhase("monitoring");
    }
  }

  async function runCutoverPreflight() {
    setPhase("cutover-preflight");
    setError(null);
    try {
      const res = await fetch("/api/neon/cutover/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setCutoverPre(body);
      setPhase("cutover-ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cutover preflight failed");
      setPhase("monitoring");
    }
  }

  async function executeCutover() {
    if (!confirmCutover) {
      setConfirmCutover(true);
      return;
    }
    setPhase("cutting-over");
    setError(null);
    try {
      const res = await fetch("/api/neon/cutover/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setCutoverResult(body);
      setConfirmCutover(false);
      setPhase("cutover-complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cutover failed");
      setPhase("cutover-ready");
    }
  }

  async function runAnalyzeTarget() {
    const previous = phase;
    setPhase("analyzing-target");
    setError(null);
    try {
      const res = await fetch("/api/neon/analyze-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setAnalyzeResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ANALYZE failed");
    } finally {
      setPhase(previous);
    }
  }

  async function runRollback() {
    if (!confirm("Re-enable the subscription? Only do this if no new writes have landed on the target."))
      return;
    setError(null);
    try {
      const res = await fetch("/api/neon/cutover/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setCutoverResult(null);
      setCutoverPre(null);
      setPhase("monitoring");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback failed");
    }
  }

  async function copyConnectionString(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedConn(true);
      setTimeout(() => setCopiedConn(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const fetchMonitor = useCallback(async () => {
    setMonitorLoading(true);
    try {
      const qs = new URLSearchParams();
      if (targetOverride?.connectionUri)
        qs.set("target", targetOverride.connectionUri);
      if (sourceOverride?.connectionUri)
        qs.set("source", sourceOverride.connectionUri);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      const res = await fetch(`/api/neon/replication/monitor${q}`);
      const body = await res.json();
      if (res.ok) setMonitor(body);
    } catch {
      /* swallow */
    } finally {
      setMonitorLoading(false);
    }
  }, [sourceOverride, targetOverride]);

  useEffect(() => {
    if (!monitorAutopoll) return;
    fetchMonitor();
    const id = setInterval(fetchMonitor, 5000);
    return () => clearInterval(id);
  }, [monitorAutopoll, fetchMonitor]);

  async function copySql(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedSql(key);
      setTimeout(() => setCopiedSql((k) => (k === key ? null : k)), 1500);
    } catch {
      /* ignore */
    }
  }

  async function handleRecoveryAction(
    id: RecoveryActionId,
    payload?: Record<string, unknown>,
  ) {
    setError(null);
    setClassifiedError(null);
    switch (id) {
      case "drop-orphan-slot":
      case "drop-orphan-subscription": {
        try {
          const res = await fetch("/api/neon/replication/force-cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...targetBody(),
              ...(payload ?? {}),
            }),
          });
          const body = await res.json();
          if (!res.ok)
            throw new Error(handleApiError(body, `Failed (${res.status})`));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Cleanup failed");
        }
        return;
      }
      case "rerun-setup":
        await runSetup();
        return;
      case "rerun-preflight":
        await runPreflight();
        return;
      case "enable-logical-replication":
        // Two-click confirm flow lives on the Enable button; surface that.
        setConfirmEnable(true);
        return;
      case "open-settings":
        setSettingsOpen(true);
        return;
      case "open-neon-console":
        window.open(
          "https://console.neon.tech/app/settings/api-keys",
          "_blank",
        );
        return;
      case "use-unpooled-connection":
        setSettingsOpen(true);
        return;
    }
  }

  /* Readiness counts projects picked in the app (stored as overrides), not
     just the env vars cfg reports. Gating on cfg alone made the pickers
     below unreachable, since they only render past this point. */
  const sourceReady = Boolean(
    sourceOverride?.connectionUri || cfg?.hasSourceConnection,
  );
  const targetReady = Boolean(
    targetOverride?.connectionUri || cfg?.hasTargetConnection,
  );

  const apiKeyAction = (
    <Button size="lg" variant="outline" onClick={() => setSettingsOpen(true)}>
      <Settings className="h-3.5 w-3.5" />
      API key
    </Button>
  );

  const pickerRow = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#262727] bg-[#131414] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-caption">
        <TargetProjectPicker
          role="source"
          targetPgVersion={assessment?.sourceVersion ?? 14}
          onChange={(t) => {
            setSourceOverrideState(t);
            // Switching source invalidates all downstream state
            setPreflight(null);
            setSetup(null);
            setStatus(null);
            setMonitor(null);
            setCutoverPre(null);
            setCutoverResult(null);
            setPhase("idle");
          }}
        />
        <span className="text-[#00e599]">→</span>
        <TargetProjectPicker
          role="target"
          targetPgVersion={assessment?.targetVersion ?? 17}
          onChange={(t) => {
            setTargetOverrideState(t);
            setPreflight(null);
            setSetup(null);
            setStatus(null);
            setMonitor(null);
            setCutoverPre(null);
            setCutoverResult(null);
            setPhase("idle");
          }}
        />
      </div>
      <span className="font-mono text-label text-[#9ca3af]">phase: {phase}</span>
    </div>
  );

  if (!sourceReady || !targetReady) {
    return (
      <div className={neon.page}>
        <div className={neon.pageContent}>
          <PageHeader
            title="Logical replication"
            subtitle="One-click logical replication setup between your source and target Neon projects"
            actions={apiKeyAction}
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
                Replication needs both sides. Choose them above and the app
                fetches their direct connection strings from the Neon API. You
                can also set NEON_SOURCE_CONNECTION_STRING and
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
          <NeonSettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onSaved={() => setHasKey(hasNeonCredentials())}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={neon.page}>
      <div className={neon.pageContent}>
        <PageHeader
          title="Logical replication"
          subtitle="Source → target setup, automated. Schema copy · publication · subscription · live lag monitoring."
          actions={apiKeyAction}
        />

        {pickerRow}

        {/* Brief overview, collapsible. Lands users oriented without
            forcing them to read a wall of text before they can act. */}
        <details className="mb-5 rounded-[4px] border border-[#262727] bg-[#131414] p-4">
          <summary className="cursor-pointer text-ui text-foreground">
            How the full setup works (6 steps), click to expand
          </summary>
          <ol className="mt-3 space-y-2 text-caption text-[#f3f4f6]">
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">01</span>
              <div>
                <span className="text-foreground">Preflight</span> reads source +
                target catalogs to verify <span className="font-mono">wal_level</span>,
                REPLICATION role, primary keys, and target schema readiness.
                Read-only, runs whenever you click the button.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">02</span>
              <div>
                <span className="text-foreground">Enable logical replication</span>{" "}
                calls the Neon API (
                <span className="font-mono">PATCH /projects/{"{id}"}</span>{" "}
                with{" "}
                <span className="font-mono">
                  enable_logical_replication: true
                </span>
                ) on the source. Flips{" "}
                <span className="font-mono">wal_level</span> from{" "}
                <span className="font-mono">replica</span> to{" "}
                <span className="font-mono">logical</span> permanently and
                restarts source computes once. If already enabled, this step
                is a no-op.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">03</span>
              <div>
                <span className="text-foreground">Provision pub/sub</span> copies
                schema (extensions, sequences, tables, indexes) to the target
                if needed, then runs{" "}
                <span className="font-mono">CREATE PUBLICATION</span> on
                source and{" "}
                <span className="font-mono">CREATE SUBSCRIPTION</span> on
                target with{" "}
                <span className="font-mono">copy_data = true</span>. Initial
                copy begins immediately.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">04</span>
              <div>
                <span className="text-foreground">Live status</span> polls{" "}
                <span className="font-mono">pg_stat_subscription</span> and{" "}
                <span className="font-mono">pg_subscription_rel</span> on
                target every 3s to show per-table state (copying, ready) and
                replication lag.{" "}
                <span className="text-foreground">04b Monitoring</span> runs Neon's
                recommended publisher + subscriber health queries on demand.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">05</span>
              <div>
                <span className="text-foreground">Cutover</span> preflight checks
                row counts, sequence drift, slot activity, then on execute
                runs: drain lag, reset target sequences via Neon's DO block
                (so the first nextval() after cutover doesn't collide),
                verify, disable subscription. Whole thing takes a few seconds
                under steady state.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">06</span>
              <div>
                <span className="text-foreground">Cutover complete</span> surfaces
                the new primary connection string for you to swap into your
                app's <span className="font-mono">DATABASE_URL</span>, with a
                deep-link to the target project in the Neon Console.
              </div>
            </li>
          </ol>
          <p className="mt-3 text-label text-[#9ca3af]">
            Each step also lives in Neon's docs:{" "}
            <a
              href="https://neon.com/docs/guides/logical-replication-neon-to-neon"
              target="_blank"
              rel="noreferrer"
              className="text-[#00e599] hover:underline"
            >
              Replicate from one Neon project to another
            </a>
            .
          </p>
        </details>

        {/* Step 1: Preflight */}
        <Section
          step="01"
          title="Preflight"
          subtitle="Verify source wal_level, replication role, table primary keys, target schema readiness"
          action={
            <Button size="lg"
              onClick={runPreflight}
              disabled={phase === "preflighting"}
              variant={preflight ? "outline" : "white"}
            >
              {phase === "preflighting" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {preflight ? "Re-check" : "Run preflight"}
                </>
              )}
            </Button>
          }
        >
          {preflight && <PreflightDetails p={preflight} />}
        </Section>

        {/* Step 2: Enable logical replication. Always shown so users see
            the full documented flow, but rendered as 'already done' when
            preflight reports wal_level=logical (irreversible flip). */}
        {preflight && preflight.source.logicalReplicationEnabled && (
          <Section
            step="02"
            title="Logical replication enabled on source"
            subtitle="wal_level=logical is set permanently on the source project"
          >
            <div className="flex items-center gap-2 rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.08] px-3 py-2 text-caption text-[#00e599]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Already enabled, this step is a no-op for your source. The Neon
              API call (PATCH /projects/{sourceProjectId} with{" "}
              <span className="font-mono">enable_logical_replication: true</span>)
              was applied earlier and cannot be undone.
            </div>
          </Section>
        )}
        {preflight && !preflight.source.logicalReplicationEnabled && (
          <Section
            step="02"
            title="Enable logical replication on source"
            subtitle="Permanently switches wal_level to logical and restarts all source computes"
            danger
            action={
              <div className="flex flex-col items-end gap-2">
                <Button size="lg"
                  onClick={enableSourceLogicalReplication}
                  disabled={!hasKey || phase === "enabling"}
                  variant={confirmEnable ? "destructive" : "white"}
                >
                  {phase === "enabling" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Enabling…
                    </>
                  ) : confirmEnable ? (
                    <>
                      <AlertOctagon className="h-3.5 w-3.5" />
                      Confirm — this is irreversible
                    </>
                  ) : (
                    <>
                      <Power className="h-3.5 w-3.5" />
                      Enable on {sourceProjectId}
                    </>
                  )}
                </Button>
                {!hasKey && (
                  <p className="text-label text-[#f59e0b]">
                    Add a Neon API key in settings to enable
                  </p>
                )}
              </div>
            }
          >
            <p className={`text-caption ${neon.muted}`}>
              Neon API <span className="font-mono">PATCH /projects/{sourceProjectId}</span>{" "}
              with <span className="font-mono">enable_logical_replication: true</span>. After
              this, <span className="font-mono">wal_level=logical</span> permanently and all
              project computes restart once. Active connections will drop.
            </p>
          </Section>
        )}

        {/* Step 3: Setup */}
        {preflight && preflight.source.logicalReplicationEnabled && !setup && (
          <Section
            step="03"
            title="Provision publication + subscription"
            subtitle="Copies schema, creates publication on source, creates subscription on target"
            action={
              <Button size="lg" variant="white" onClick={runSetup} disabled={!preflight.ok || phase === "setting-up"}>
                {phase === "setting-up" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Provisioning…
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    Start replication
                  </>
                )}
              </Button>
            }
          >
            <ol className="space-y-2 text-caption text-[#f3f4f6]">
              <li>
                <span className="font-mono text-[#00e599]">01</span> Copy extensions + table
                schemas to target (idempotent)
              </li>
              <li>
                <span className="font-mono text-[#00e599]">02</span> CREATE PUBLICATION{" "}
                <span className="font-mono">neon_advisor_pub</span> FOR ALL TABLES on source
              </li>
              <li>
                <span className="font-mono text-[#00e599]">03</span> CREATE SUBSCRIPTION{" "}
                <span className="font-mono">neon_advisor_sub</span> on target with{" "}
                <span className="font-mono">copy_data = true</span>
              </li>
            </ol>
          </Section>
        )}

        {/* Step 4: Monitor */}
        {setup && (
          <Section
            step="04"
            title="Live replication status"
            subtitle={`Subscription ${setup.subscriptionName} · ${setup.tables.length} table(s)`}
            action={
              <div className="flex gap-2">
                <Button size="lg" variant="ghost" onClick={pollStatus}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button size="lg" variant="destructive" onClick={runTeardown}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Teardown
                </Button>
              </div>
            }
          >
            {status ? <StatusDetails s={status} /> : (
              <p className={`text-caption ${neon.muted}`}>Awaiting first status poll…</p>
            )}
          </Section>
        )}

        {/* Logical replication monitoring (Neon recommended health queries) */}
        {setup && (
          <Section
            step="04b"
            title="Logical replication monitoring"
            subtitle="Subscriber per-table state + publisher LSN distance, straight from Neon's recommended monitoring queries"
            action={
              <div className="flex gap-2">
                <Button size="lg" variant="ghost" onClick={fetchMonitor}>
                  {monitorLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Refresh
                </Button>
                <Button size="lg"
                  variant={monitorAutopoll ? "destructive" : "outline"}
                  onClick={() => setMonitorAutopoll((a) => !a)}
                >
                  {monitorAutopoll ? "Stop auto-poll" : "Auto-poll 5s"}
                </Button>
              </div>
            }
          >
            {monitor ? (
              <MonitorDetails
                m={monitor}
                copiedSql={copiedSql}
                onCopySql={copySql}
              />
            ) : (
              <p className={`text-caption ${neon.muted}`}>
                Click Refresh to run the monitoring queries.
              </p>
            )}
          </Section>
        )}

        {/* Step 5: Cutover */}
        {setup && status?.state === "streaming" && !cutoverResult && (
          <Section
            step="05"
            title="Cutover"
            subtitle="Drain lag, reset sequences, disable subscription, swap connection strings"
            danger
            action={
              !cutoverPre ? (
                <Button size="lg" variant="white"
                  onClick={runCutoverPreflight}
                  disabled={phase === "cutover-preflight"}
                >
                  {phase === "cutover-preflight" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Cutover preflight
                    </>
                  )}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="lg" variant="ghost" onClick={runCutoverPreflight}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-check
                  </Button>
                  <Button size="lg"
                    onClick={executeCutover}
                    disabled={!cutoverPre.ok || phase === "cutting-over"}
                    variant={confirmCutover ? "destructive" : "white"}
                  >
                    {phase === "cutting-over" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cutting over…
                      </>
                    ) : confirmCutover ? (
                      <>
                        <AlertOctagon className="h-3.5 w-3.5" />
                        Confirm cutover
                      </>
                    ) : (
                      <>
                        <Repeat className="h-3.5 w-3.5" />
                        Execute cutover
                      </>
                    )}
                  </Button>
                </div>
              )
            }
          >
            {cutoverPre && <CutoverPreflightDetails p={cutoverPre} />}
          </Section>
        )}

        {/* Step 6: Cutover complete */}
        {cutoverResult && (
          <Section
            step="06"
            title="Cutover complete"
            subtitle={`Took ${(cutoverResult.totalDurationMs / 1000).toFixed(2)}s · ${cutoverResult.sequencesReset.length} sequence(s) reset · final lag ${cutoverResult.finalLagBytes ?? "?"} bytes`}
            action={
              <Button size="lg" variant="ghost" onClick={runRollback}>
                <Undo2 className="h-3.5 w-3.5" />
                Rollback
              </Button>
            }
          >
            <CutoverResultDetails
              r={cutoverResult}
              onCopyConn={() => copyConnectionString(cutoverResult.newPrimaryConnectionString)}
              copiedConn={copiedConn}
              targetProjectId={targetOverride?.projectId ?? cfg?.targetProjectId ?? null}
            />
          </Section>
        )}

        {/* Step 7: Rebuild optimizer statistics on the target */}
        {setup && (status?.state === "streaming" || cutoverResult) && (
          <Section
            step="07"
            title="Analyze target"
            subtitle="Rebuild optimizer statistics before traffic reaches the target"
            action={
              <Button
                size="lg"
                onClick={runAnalyzeTarget}
                disabled={phase === "analyzing-target"}
                variant={analyzeResult ? "ghost" : "white"}
              >
                {phase === "analyzing-target" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Running ANALYZE…
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5" />
                    {analyzeResult ? "Re-run ANALYZE" : "Run ANALYZE"}
                  </>
                )}
              </Button>
            }
          >
            {analyzeResult ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
                    <p className="tag">Relations</p>
                    <p className="mt-2 text-heading font-medium tnum text-foreground">
                      {analyzeResult.relations}
                    </p>
                  </div>
                  <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
                    <p className="tag">Were missing stats</p>
                    <p className="mt-2 text-heading font-medium tnum text-foreground">
                      {analyzeResult.missingStatsBefore}
                    </p>
                  </div>
                  <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
                    <p className="tag">Still missing</p>
                    <p
                      className={`mt-2 text-heading font-medium tnum ${
                        analyzeResult.missingStatsAfter === 0
                          ? "text-[#00e599]"
                          : "text-[#f59e0b]"
                      }`}
                    >
                      {analyzeResult.missingStatsAfter}
                    </p>
                  </div>
                </div>
                <div
                  className={`rounded-[4px] border px-3 py-2 text-caption ${
                    analyzeResult.missingStatsAfter === 0
                      ? "border-[#00e599]/40 bg-[#00e599]/[0.08] text-[#00e599]"
                      : "border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] text-[#f59e0b]"
                  }`}
                >
                  {analyzeResult.missingStatsAfter === 0 ? (
                    <>
                      <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
                      Every relation has statistics. Took{" "}
                      {(analyzeResult.durationMs / 1000).toFixed(2)}s.
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                      {analyzeResult.missingStatsAfter} relation(s) still have no
                      statistics — ANALYZE skips relations the connecting role
                      doesn&apos;t own. Re-run as the table owner.
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] px-3 py-2 text-caption text-[#f59e0b]">
                <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                Logical replication copies rows but never replicates{" "}
                <span className="font-mono">pg_statistic</span>. Until you run
                ANALYZE, the planner on the target has no statistics and will
                choose sequential scans over indexes — the classic &ldquo;upgraded
                and CPU pinned at 100%&rdquo; failure. Scaling compute
                doesn&apos;t fix it, and autoanalyze may not reach a
                freshly-loaded read-mostly table for a long time. Run this while
                the target is still idle.
              </div>
            )}
          </Section>
        )}

        {classifiedError ? (
          <ClassifiedErrorBanner
            classified={classifiedError}
            onAction={handleRecoveryAction}
          />
        ) : (
          error && (
            <div className="mt-4 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-caption text-[#ef4444]">
              <span className="font-mono">error:</span> {error}
            </div>
          )
        )}

        <NeonSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => setHasKey(hasNeonCredentials())}
        />
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

function PreflightDetails({ p }: { p: ReplicationPreflight }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-4">
        <p className="tag mb-2">Source</p>
        <KV k="PG version" v={`PostgreSQL ${p.source.pgVersion}`} />
        <KV
          k="wal_level"
          v={p.source.walLevel}
          tone={p.source.logicalReplicationEnabled ? "ok" : "warn"}
        />
        <KV
          k="REPLICATION role"
          v={`${p.source.rolname} · ${p.source.roleHasReplication ? "yes" : "no"}`}
          tone={p.source.roleHasReplication ? "ok" : "bad"}
        />
        <KV k="Public tables" v={String(p.source.tableCount)} />
        {p.source.tablesWithoutPK.length > 0 && (
          <KV
            k="Tables w/o PK"
            v={`${p.source.tablesWithoutPK.length} (updates/deletes won't replicate)`}
            tone="warn"
          />
        )}
      </div>
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-4">
        <p className="tag mb-2">Target</p>
        <KV k="PG version" v={`PostgreSQL ${p.target.pgVersion}`} />
        <KV
          k="Schema loaded"
          v={`${p.target.schemaTableCount} tables`}
          tone={p.target.schemaLoaded ? "ok" : "warn"}
        />
        {p.target.existingSubscription && (
          <KV
            k="Existing subscription"
            v={p.target.existingSubscription}
            tone="warn"
          />
        )}
      </div>

      <div className="sm:col-span-2 space-y-2">
        {p.blockers.map((b, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/[0.08] px-3 py-2 text-caption text-[#ef4444]"
          >
            <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {b}
          </div>
        ))}
        {p.warnings.map((w, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] px-3 py-2 text-caption text-[#f59e0b]"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {w}
          </div>
        ))}
        {p.ok && p.blockers.length === 0 && p.warnings.length === 0 && (
          <div className="flex items-center gap-2 rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.08] px-3 py-2 text-caption text-[#00e599]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All checks passed — ready to start replication.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDetails({ s }: { s: ReplicationStatus }) {
  const lagText =
    s.lagBytes === null
      ? "—"
      : s.lagBytes < 1024
        ? `${s.lagBytes} B`
        : s.lagBytes < 1024 * 1024
          ? `${(s.lagBytes / 1024).toFixed(1)} KB`
          : `${(s.lagBytes / 1024 / 1024).toFixed(2)} MB`;

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          icon={s.state === "streaming" ? PlayCircle : Database}
          label="State"
          value={s.state}
          tone={
            s.state === "streaming" ? "ok" : s.state === "copying" ? "warn" : "muted"
          }
        />
        <Stat
          icon={ArrowRight}
          label="Replication lag"
          value={lagText}
          tone={s.lagBytes === null || s.lagBytes === 0 ? "ok" : "warn"}
        />
        <Stat
          icon={Database}
          label="Initial copy"
          value={
            s.initialCopyProgress === null ? "done" : `${s.initialCopyProgress}%`
          }
          tone={s.initialCopyProgress === null ? "ok" : "warn"}
        />
      </div>

      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Per-table state</p>
        <div className="grid gap-1 text-label">
          {s.perTable.length === 0 ? (
            <p className={neon.muted}>No tables in subscription yet.</p>
          ) : (
            s.perTable.map((t) => (
              <div key={t.table} className="flex items-center justify-between font-mono">
                <span className="text-foreground">{t.table}</span>
                <span
                  className={
                    t.state === "streaming"
                      ? "text-[#00e599]"
                      : t.state === "synchronized"
                        ? "text-[#00e599]"
                        : "text-[#f59e0b]"
                  }
                >
                  {t.state}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {s.receivedLsn && (
        <p className="mt-3 font-mono text-label text-[#9ca3af]">
          received_lsn = {s.receivedLsn} · latest_end_lsn = {s.latestEndLsn ?? "—"}
        </p>
      )}
    </>
  );
}

function MonitorDetails({
  m,
  copiedSql,
  onCopySql,
}: {
  m: ReplicationMonitor;
  copiedSql: string | null;
  onCopySql: (key: string, value: string) => void;
}) {
  const stateColor: Record<string, string> = {
    Ready: "text-[#00e599]",
    Synchronized: "text-[#00e599]",
    "Finished table copy": "text-[#00e599]",
    "Data being copied": "text-[#f59e0b]",
    Initialize: "text-[#4f9eed]",
    Unknown: "text-[#9ca3af]",
  };
  return (
    <div className="space-y-4">
      {/* Top-level verdict */}
      <div
        className={`rounded-[4px] border px-3 py-2 text-caption ${
          m.initialReplicationComplete
            ? "border-[#00e599]/40 bg-[#00e599]/[0.08] text-[#00e599]"
            : "border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] text-[#f59e0b]"
        }`}
      >
        {m.initialReplicationComplete ? (
          <>
            <CheckCircle2 className="mr-1.5 inline h-3.5 w-3.5" />
            Initial replication complete — every table is Ready.
          </>
        ) : (
          <>
            <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
            Initial replication still in progress.
          </>
        )}
      </div>

      {/* Subscriber */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="tag">Subscriber — per-table state</p>
          <button
            type="button"
            onClick={() => onCopySql("subscriber", m.sql.subscriber)}
            className="flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-label text-[#9ca3af] hover:bg-[#1a1b1b] hover:text-foreground"
            title="Optional, copy the SQL behind this table so you can run it in the Neon SQL editor yourself"
          >
            {copiedSql === "subscriber" ? (
              <>
                <Check className="h-3 w-3 text-[#00e599]" />
                Copied
              </>
            ) : (
              <>
                <Terminal className="h-3 w-3" />
                Copy SQL
              </>
            )}
          </button>
        </div>
        {m.subscriber.length === 0 ? (
          <p className={`text-label ${neon.muted}`}>No subscriptions.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <thead className="border-b border-[#262727] text-left text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
                <tr>
                  <th className="px-2 py-1.5">Subscription</th>
                  <th className="px-2 py-1.5">Table</th>
                  <th className="px-2 py-1.5">Status</th>
                  <th
                    className="px-2 py-1.5 text-right"
                    title="srsublsn — the LSN at which initial copy finished. Once Ready, this column doesn't update. For live position, see the Publisher LSN distance below."
                  >
                    Init copy ended at
                  </th>
                </tr>
              </thead>
              <tbody>
                {m.subscriber.map((r) => (
                  <tr
                    key={`${r.subscriptionId}-${r.tableName}`}
                    className="border-b border-[#262727]/60 last:border-0"
                  >
                    <td className="px-2 py-1.5 font-mono text-[#f3f4f6]">
                      {r.subscriptionName}
                      <span className="ml-1 text-[#9ca3af]">
                        ({r.subscriptionId})
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-foreground">
                      {r.tableName}
                    </td>
                    <td className={`px-2 py-1.5 ${stateColor[r.tableStatus] ?? ""}`}>
                      {r.tableStatus}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-[#9ca3af]">
                      {r.tableLsn ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-label text-[#9ca3af]">
          <span className="text-[#00e599]">Ready</span> means initial copy
          finished and the table is now being kept up to date by the apply
          worker. <span className="font-mono">Init copy ended at</span> is a
          historical marker (<span className="font-mono">srsublsn</span>) — for
          live replication position, see the publisher panel below.
        </p>
      </div>

      {/* Publisher */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="tag">Publisher — LSN distance per slot</p>
          <button
            type="button"
            onClick={() => onCopySql("publisher", m.sql.publisher)}
            className="flex items-center gap-1 rounded-[4px] px-2 py-0.5 text-label text-[#9ca3af] hover:bg-[#1a1b1b] hover:text-foreground"
          >
            {copiedSql === "publisher" ? (
              <>
                <Check className="h-3 w-3 text-[#00e599]" />
                Copied
              </>
            ) : (
              <>
                <Terminal className="h-3 w-3" />
                Copy SQL
              </>
            )}
          </button>
        </div>
        {m.publisher.length === 0 ? (
          <p className={`text-label ${neon.muted}`}>No replication slots.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <thead className="border-b border-[#262727] text-left text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
                <tr>
                  <th className="px-2 py-1.5">Slot</th>
                  <th className="px-2 py-1.5">Confirmed flush LSN</th>
                  <th className="px-2 py-1.5">Current WAL LSN</th>
                  <th className="px-2 py-1.5 text-right">LSN distance</th>
                  <th className="px-2 py-1.5 text-right">Pretty size</th>
                </tr>
              </thead>
              <tbody>
                {m.publisher.map((r) => (
                  <tr
                    key={r.slotName}
                    className="border-b border-[#262727]/60 last:border-0"
                  >
                    <td className="px-2 py-1.5 font-mono text-foreground">
                      {r.slotName}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[#f3f4f6]">
                      {r.confirmedFlushLsn}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[#f3f4f6]">
                      {r.currentWalLsn}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tnum text-[#f3f4f6]">
                      {r.lsnDistance.toLocaleString()}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-right font-mono ${
                        r.lsnDistance === 0
                          ? "text-[#00e599]"
                          : r.lsnDistance > 64 * 1024
                            ? "text-[#ef4444]"
                            : "text-[#f59e0b]"
                      }`}
                    >
                      {r.lsnDistanceSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <summary className="cursor-pointer text-caption text-[#9ca3af] hover:text-foreground">
          Optional, the underlying SQL the panel ran
        </summary>
        <p className="mt-2 text-label text-[#9ca3af]">
          The tables above already show these results. This is here only if you
          want to inspect or rerun the queries yourself in the Neon SQL editor.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <p className="tag mb-1">Subscriber</p>
            <pre className="overflow-x-auto rounded-[4px] border border-[#262727] bg-[#131414] p-2 font-mono text-micro text-[#f3f4f6]">
              {m.sql.subscriber}
            </pre>
          </div>
          <div>
            <p className="tag mb-1">Publisher</p>
            <pre className="overflow-x-auto rounded-[4px] border border-[#262727] bg-[#131414] p-2 font-mono text-micro text-[#f3f4f6]">
              {m.sql.publisher}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}

function CutoverPreflightDetails({ p }: { p: CutoverPreflight }) {
  const lagText =
    p.replicationLagBytes === null
      ? "—"
      : p.replicationLagBytes < 1024
        ? `${p.replicationLagBytes} B`
        : `${(p.replicationLagBytes / 1024).toFixed(1)} KB`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag">Replication lag</p>
          <p className="mt-2 text-heading font-medium tnum text-foreground">{lagText}</p>
        </div>
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag">All tables streaming</p>
          <p
            className={`mt-2 text-heading font-medium ${
              p.allTablesStreaming ? "text-[#00e599]" : "text-[#f59e0b]"
            }`}
          >
            {p.allTablesStreaming ? "yes" : "no"}
          </p>
        </div>
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag">Sequences to reset</p>
          <p className="mt-2 text-heading font-medium tnum text-foreground">
            {p.sequenceDrift.length}
          </p>
        </div>
      </div>

      {/* Row count check */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Row count parity</p>
        <div className="grid gap-1 text-label">
          {p.rowCounts.map((r) => (
            <div key={r.table} className="flex items-center justify-between font-mono">
              <span className="text-foreground">{r.table}</span>
              <span className="flex items-center gap-2">
                <span className="text-[#9ca3af]">
                  src {r.sourceRows.toLocaleString()} · tgt {r.targetRows.toLocaleString()}
                </span>
                <span
                  className={
                    r.match ? "text-[#00e599]" : "text-[#f59e0b]"
                  }
                >
                  {r.match ? "✓" : `Δ${r.delta}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sequence drift table */}
      {p.sequenceDrift.length > 0 && (
        <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
          <p className="tag mb-2">
            Sequence drift, will be reset during cutover
          </p>
          <p className="mb-3 text-label leading-[1.55] text-[#f3f4f6]">
            Logical replication copies rows but not the sequence counter
            behind them. Right now your target sequences are still near 1,
            so the first INSERT after cutover would call{" "}
            <span className="font-mono">nextval()</span>, get back a low
            number like 2 or 3, and fail with{" "}
            <span className="font-mono text-[#ef4444]">
              duplicate key value violates unique constraint
            </span>{" "}
            because that ID already exists from replication.
          </p>
          <p className="mb-3 text-label leading-[1.55] text-[#9ca3af]">
            In your app this shows up as 500 errors on every write, retried
            inserts looping, ORM transactions rolling back, queues backing
            up, and audit/event rows silently dropped, until the sequence
            catches up past the highest replicated ID. The cutover step
            fixes this in one shot by setting each target sequence to{" "}
            <span className="font-mono">MAX(column)</span> on target.
          </p>
          <div className="grid gap-1 text-label">
            {p.sequenceDrift.map((s) => (
              <div
                key={s.sequence}
                className="flex items-center justify-between font-mono"
              >
                <span className="text-foreground">
                  {s.sequence}{" "}
                  {s.table && (
                    <span className="text-[#9ca3af]">
                      → {s.table}.{s.column}
                    </span>
                  )}
                </span>
                <span className="text-[#9ca3af]">
                  src max {s.sourceLastValue.toLocaleString()}, tgt at{" "}
                  {s.targetLastValue.toLocaleString()} → set tgt to{" "}
                  <span className="text-[#00e599]">
                    {s.recommendedTargetValue.toLocaleString()}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blockers / warnings */}
      <div className="space-y-2">
        {p.blockers.map((b, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/[0.08] px-3 py-2 text-caption text-[#ef4444]"
          >
            <AlertOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {b}
          </div>
        ))}
        {p.warnings.map((w, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] px-3 py-2 text-caption text-[#f59e0b]"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {w}
          </div>
        ))}
        {p.ok && p.blockers.length === 0 && p.warnings.length === 0 && (
          <div className="flex items-center gap-2 rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.08] px-3 py-2 text-caption text-[#00e599]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready to cut over. Click Execute cutover when your app is ready.
          </div>
        )}
      </div>
    </div>
  );
}

function CutoverResultDetails({
  r,
  onCopyConn,
  copiedConn,
  targetProjectId,
}: {
  r: CutoverResult;
  onCopyConn: () => void;
  copiedConn: boolean;
  targetProjectId: string | null;
}) {
  const statusColor: Record<string, string> = {
    ok: "text-[#00e599]",
    failed: "text-[#ef4444]",
    skipped: "text-[#9ca3af]",
    running: "text-[#f59e0b]",
    pending: "text-[#9ca3af]",
  };
  return (
    <div className="space-y-4">
      {/* Step log */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Cutover timeline</p>
        <div className="space-y-1.5">
          {r.steps.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 text-caption">
              <div className="flex min-w-0 items-start gap-2">
                <span className={`font-mono ${statusColor[s.status] ?? ""}`}>
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
                {s.durationMs !== undefined ? `${s.durationMs}ms` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* New primary banner */}
      <div className="rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.06] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="tag text-[#00e599]">New primary connection string</p>
          <div className="flex gap-2">
            <Button size="lg" variant="ghost" onClick={onCopyConn}>
              {copiedConn ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#00e599]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
            {targetProjectId && (
              <a
                href={`https://console.neon.tech/app/projects/${targetProjectId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-caption font-medium text-[#0c0d0d] transition-[scale,background-color,border-color,color] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d] hover:bg-[#f3f4f6]"
              >
                Open in Neon Console
                <ArrowRight className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <p className="break-all font-mono text-label text-[#f3f4f6]">
          {r.newPrimaryConnectionString.replace(/:([^:@]+)@/, ":••••••@")}
        </p>
        {targetProjectId && (
          <p className="mt-2 text-label text-[#9ca3af]">
            The Console's Connect button will show this project's connection
            strings for every role and database, plus a one-click Connect
            modal you can copy into your app.
          </p>
        )}
      </div>

      {/* Post-cutover checklist */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-4">
        <p className="tag mb-3">Next steps</p>
        <ol className="space-y-1.5 text-caption text-[#f3f4f6]">
          {r.postCutoverActions.map((a, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">
                {String(i + 1).padStart(2, "0")}
              </span>
              {a}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function KV({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "ok" | "warn" | "bad";
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
    <div className="flex items-center justify-between border-b border-[#262727]/60 py-1.5 last:border-0 text-caption">
      <span className="text-[#9ca3af]">{k}</span>
      <span className={`font-mono ${color}`}>{v}</span>
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
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  const color =
    tone === "ok"
      ? "#00e599"
      : tone === "warn"
        ? "#f59e0b"
        : tone === "bad"
          ? "#ef4444"
          : "#9ca3af";
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
