"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Loader2,
  PlayCircle,
  Power,
  RefreshCw,
  Repeat,
  LogIn,
  Terminal,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import { useAssessment } from "@/components/AssessmentProvider";
import { TargetProjectPicker } from "@/components/TargetProjectPicker";
import { ClassifiedErrorBanner } from "@/components/ClassifiedErrorBanner";
import { PageHeader, neon } from "@/components/ui";
import {
  Notice,
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
  getSourceOverride,
  getTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";
import type {
  AnalyzeTargetResult,
  CutoverPreflight,
  CutoverResult,
  ReplicationMonitor,
  ReplicationPreflight,
  ReplicationResourceInspection,
  ReplicationSetupResult,
  ReplicationStatus,
  ReplicationTeardownResult,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

interface NeonConfig {
  orgName: string | null;
  orgId: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  hasSourceConnection: boolean;
  hasTargetConnection: boolean;
  authenticated: boolean;
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

const MIGRATION_STEPS = [
  "Preflight",
  "Enable logical replication",
  "Provision replication",
  "Live replication",
  "Analyze target",
  "Cutover",
] as const;

type MigrationStepState = "completed" | "current" | "blocked" | "upcoming";
type MigrationQuietStatusState =
  | "ready"
  | "provisioning"
  | "error"
  | "stopped"
  | "warning";

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
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [tableSelectionReady, setTableSelectionReady] = useState(false);
  const [resumedSession, setResumedSession] = useState(false);
  const [teardownInspection, setTeardownInspection] =
    useState<ReplicationResourceInspection | null>(null);
  const [teardownResult, setTeardownResult] =
    useState<ReplicationTeardownResult | null>(null);
  const [confirmTeardown, setConfirmTeardown] = useState(false);
  const [teardownInspecting, setTeardownInspecting] = useState(false);
  const [teardownRecheckAttempts, setTeardownRecheckAttempts] = useState(0);
  const recoveryChecks = useRef(new Set<string>());

  useEffect(() => {
    // Hydrate tab-scoped project choices after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargetOverrideState(getTargetOverride());
    setSourceOverrideState(getSourceOverride());
  }, []);

  /* The source can come from an in-app pick or the env default, and the
     Neon API calls below need its project id either way. */
  const sourceProjectId = sourceOverride?.projectId ?? cfg?.sourceProjectId ?? null;
  const targetProjectId = targetOverride?.projectId ?? cfg?.targetProjectId ?? null;

  // Routes resolve connection URIs server-side from these project ids. The
  // browser never receives or stores database passwords.
  const targetBody = useCallback((includeTables = false) => {
    const body: {
      sourceProjectId?: string;
      targetProjectId?: string;
      tables?: string[];
    } = {};
    if (sourceProjectId) body.sourceProjectId = sourceProjectId;
    if (targetProjectId) body.targetProjectId = targetProjectId;
    if (includeTables && tableSelectionReady) {
      body.tables = selectedTables;
    }
    return body;
  }, [
    selectedTables,
    sourceProjectId,
    tableSelectionReady,
    targetProjectId,
  ]);

  const resumeMonitoring = useCallback((existingStatus: ReplicationStatus) => {
    const tables = existingStatus.perTable.map((table) => table.table);
    setStatus(existingStatus);
    setSetup({
      publicationName: "neon_advisor_pub",
      subscriptionName: existingStatus.subscriptionName,
      tables,
      startedAt: "",
      walLevelChanged: false,
      schemaCopied: true,
    });
    setSelectedTables(tables);
    setTableSelectionReady(true);
    setResumedSession(true);
    setPhase("monitoring");
  }, []);

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
    if (!classifiedError?.stage) return;

    const frame = window.requestAnimationFrame(() => {
      const panel = document.getElementById("replication-setup-error");
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ behavior: "auto", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [classifiedError]);

  const inspectTeardown = useCallback(async (): Promise<ReplicationResourceInspection | null> => {
    setTeardownInspecting(true);
    try {
      const response = await fetch("/api/neon/replication/teardown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...targetBody(), action: "inspect" }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Replication resource inspection failed");
      }
      const inspection = body as ReplicationResourceInspection;
      setError(null);
      setTeardownInspection(inspection);
      return inspection;
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "Replication resource inspection failed",
      );
      return null;
    } finally {
      setTeardownInspecting(false);
    }
  }, [targetBody]);

  const executeTeardownRequest = useCallback(async (
    options: { releaseActiveSlot?: boolean } = {},
  ) => {
    setPhase("tearing-down");
    setError(null);
    try {
      const response = await fetch("/api/neon/replication/teardown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...targetBody(),
          action: "execute",
          confirm: true,
          ...(options.releaseActiveSlot
            ? {
                releaseActiveSlot: true,
                confirmReleaseActiveSlot: true,
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        const apiError = body as {
          error?: string;
          classified?: ClassifiedError;
        };
        setClassifiedError(apiError.classified ?? null);
        throw new Error(apiError.error ?? `Failed (${response.status})`);
      }
      setClassifiedError(null);
      const result = body as ReplicationTeardownResult;
      setTeardownResult(result);
      setTeardownInspection(result.after);
      if (result.cleanupComplete) {
        setConfirmTeardown(false);
        setSetup(null);
        setStatus(null);
        setResumedSession(false);
        setCutoverPre(null);
        setPhase(cutoverResult ? "cutover-complete" : "idle");
      } else {
        // Preserve confirmation for this recovery attempt so automatic
        // rechecks can safely finish cleanup once the slot is inactive.
        setPhase(
          setup ? "monitoring" : cutoverResult ? "cutover-complete" : "idle",
        );
      }
      return result;
    } catch (teardownError) {
      setError(
        teardownError instanceof Error
          ? teardownError.message
          : "Teardown failed",
      );
      setPhase(
        setup ? "monitoring" : cutoverResult ? "cutover-complete" : "idle",
      );
      return null;
    }
  }, [cutoverResult, setup, targetBody]);

  useEffect(() => {
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);

  useEffect(() => {
    if (
      !(sourceProjectId || cfg?.hasSourceConnection) ||
      !(targetProjectId || cfg?.hasTargetConnection)
    ) {
      return;
    }
    const timeout = window.setTimeout(() => void inspectTeardown(), 0);
    return () => window.clearTimeout(timeout);
  }, [
    cfg?.hasSourceConnection,
    cfg?.hasTargetConnection,
    inspectTeardown,
    sourceProjectId,
    targetProjectId,
  ]);

  useEffect(() => {
    if (
      !cfg?.authenticated ||
      !sourceProjectId ||
      !targetProjectId ||
      setup ||
      phase !== "idle"
    ) {
      return;
    }
    const key = `${sourceProjectId}:${targetProjectId}`;
    if (recoveryChecks.current.has(key)) return;
    recoveryChecks.current.add(key);

    let cancelled = false;
    void fetch("/api/neon/replication/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetBody()),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ReplicationStatus;
      })
      .then((existingStatus) => {
        if (cancelled || !existingStatus?.subscribed) return;
        resumeMonitoring(existingStatus);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    cfg?.authenticated,
    phase,
    resumeMonitoring,
    setup,
    sourceProjectId,
    sourceOverride,
    targetBody,
    targetProjectId,
    targetOverride,
  ]);

  useEffect(() => {
    const isActiveOrphan =
      teardownInspection?.subscription.state === "absent" &&
      teardownInspection.slot.state === "active";
    if (
      !isActiveOrphan ||
      teardownRecheckAttempts >= 10 ||
      phase === "tearing-down"
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void inspectTeardown().then((inspection) => {
        setTeardownRecheckAttempts((attempts) => attempts + 1);
        if (
          confirmTeardown &&
          inspection?.subscription.state === "absent" &&
          inspection.slot.state === "present"
        ) {
          void executeTeardownRequest();
        }
      });
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [
    confirmTeardown,
    executeTeardownRequest,
    inspectTeardown,
    phase,
    teardownInspection,
    teardownRecheckAttempts,
  ]);

  // Auto-poll status during monitoring phase
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/neon/replication/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (res.ok) setStatus(body);
    } catch {
      /* swallow polling errors */
    }
  }, [targetBody]);

  useEffect(() => {
    if (phase !== "monitoring") return;
    const initial = window.setTimeout(() => void pollStatus(), 0);
    const i = setInterval(pollStatus, 3000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(i);
    };
  }, [phase, pollStatus]);

  async function runPreflight() {
    setPhase("preflighting");
    setError(null);
    try {
      const res = await fetch("/api/neon/replication/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody(tableSelectionReady)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      const result = body as ReplicationPreflight;
      setPreflight(result);
      setTeardownInspection(result.resources);
      if (!result.resources.anyResourceExists) {
        setTeardownResult(null);
        setConfirmTeardown(false);
      }
      if (!tableSelectionReady) {
        const unlogged = new Set(result.source.unloggedTables ?? []);
        setSelectedTables(
          result.source.tables.filter((table) => !unlogged.has(table)),
        );
        setTableSelectionReady(true);
      }
      if (result.resumeMonitoring) {
        const statusResponse = await fetch("/api/neon/replication/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetBody()),
        });
        if (statusResponse.ok) {
          resumeMonitoring(
            (await statusResponse.json()) as ReplicationStatus,
          );
          return;
        }
        setError(
          "An existing subscription was found, but its status could not be loaded. Refresh before running setup again.",
        );
        setPhase("idle");
        return;
      }
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
      const res = await fetch("/api/neon/replication/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    setResumedSession(false);
    try {
      const res = await fetch("/api/neon/replication/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody(true)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(handleApiError(body, `Failed (${res.status})`));
      setClassifiedError(null);
      setSetup(body);
      setPhase("monitoring");
      await inspectTeardown();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
      setPhase("preflight-done");
      const inspection = await inspectTeardown();
      if (inspection?.subscription.state === "present") {
        try {
          const statusResponse = await fetch("/api/neon/replication/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(targetBody()),
          });
          if (statusResponse.ok) {
            resumeMonitoring(
              (await statusResponse.json()) as ReplicationStatus,
            );
          }
        } catch {
          // Keep the structured setup error and inspected resource state visible.
        }
      }
    }
  }

  async function runTeardown() {
    if (!confirmTeardown) return;
    setTeardownRecheckAttempts(0);
    await executeTeardownRequest();
  }

  async function releaseActiveSlotAndTeardown() {
    if (!confirmTeardown) return;
    setTeardownRecheckAttempts(0);
    await executeTeardownRequest({ releaseActiveSlot: true });
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
      const res = await fetch("/api/neon/replication/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody()),
      });
      const body = await res.json();
      if (res.ok) setMonitor(body);
    } catch {
      /* swallow */
    } finally {
      setMonitorLoading(false);
    }
  }, [targetBody]);

  useEffect(() => {
    if (!monitorAutopoll) return;
    const initial = window.setTimeout(() => void fetchMonitor(), 0);
    const id = setInterval(fetchMonitor, 5000);
    return () => {
      window.clearTimeout(initial);
      clearInterval(id);
    };
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
        void payload;
        await inspectTeardown();
        setError(
          "Review the replication teardown panel and explicitly confirm the exact resources before cleanup.",
        );
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
        window.location.assign(
          `/api/auth/neon?returnTo=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      case "open-neon-console":
        window.open("https://console.neon.tech", "_blank");
        return;
      case "use-unpooled-connection":
        setError("Pick the project again so the app can resolve its direct endpoint.");
        return;
    }
  }

  /* Readiness counts projects picked in the app (stored as overrides), not
     just the env vars cfg reports. Gating on cfg alone made the pickers
     below unreachable, since they only render past this point. */
  const sourceReady = Boolean(
    sourceOverride?.projectId || cfg?.hasSourceConnection,
  );
  const targetReady = Boolean(
    targetOverride?.projectId || cfg?.hasTargetConnection,
  );

  const authenticated = Boolean(cfg?.authenticated);
  const authAction = authenticated ? null : (
    <Button
      size="lg"
      variant="outline"
      nativeButton={false}
      render={<a href="/api/auth/neon?returnTo=/migrate/replication" />}
    >
      <LogIn className="h-3.5 w-3.5" />
      Sign in with Neon
    </Button>
  );

  const pickerRow = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-[#262727] bg-[#131414] px-4 py-3">
      <div className="flex w-full flex-col items-stretch gap-3 text-caption sm:flex-row sm:flex-wrap sm:items-center">
        <TargetProjectPicker
          className="min-w-0 flex-wrap sm:w-auto sm:flex-nowrap"
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
            setSelectedTables([]);
            setTableSelectionReady(false);
            setResumedSession(false);
            setTeardownInspection(null);
            setTeardownResult(null);
            setConfirmTeardown(false);
            setPhase("idle");
          }}
        />
        <span
          aria-hidden
          className="self-center text-[#00e599] max-sm:rotate-90"
        >
          →
        </span>
        <TargetProjectPicker
          className="min-w-0 flex-wrap sm:w-auto sm:flex-nowrap"
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
            setResumedSession(false);
            setTeardownInspection(null);
            setTeardownResult(null);
            setConfirmTeardown(false);
            setPhase("idle");
          }}
        />
      </div>
    </div>
  );

  const workloadNotice = (
    <Notice tone="warning" className="mb-5">
      <NoticeIcon>
        <AlertTriangle />
      </NoticeIcon>
      <NoticeBody>
        <NoticeTitle>Non-critical workloads only</NoticeTitle>
        <NoticeDescription>
          Use this tool for non-critical workloads up to 1 TB.
        </NoticeDescription>
      </NoticeBody>
    </Notice>
  );

  const setupRecoveryComplete = Boolean(
    !setup &&
      !cutoverResult &&
      teardownResult?.cleanupComplete &&
      teardownResult.before.anyResourceExists &&
      teardownResult.before.subscription.state === "absent",
  );
  const setupRecoveryActive = Boolean(
    !setup &&
      !cutoverResult &&
      !setupRecoveryComplete &&
      teardownInspection?.anyResourceExists &&
      teardownInspection.subscription.state === "absent",
  );
  const setupRequirementsRemaining =
    Number(Boolean(preflight && !preflight.ok)) +
    Number(setupRecoveryActive);
  const setupClassifiedError = classifiedError?.stage
    ? classifiedError
    : null;
  const setupErrorShownInProvisioning = Boolean(
    setupClassifiedError &&
      preflight?.source.logicalReplicationEnabled &&
      !setup,
  );
  const setupNeedsAttention =
    setupRequirementsRemaining > 0 || setupErrorShownInProvisioning;
  const teardownSection =
    teardownInspection?.anyResourceExists || teardownResult ? (
      <div id="replication-teardown">
        <Section
          eyebrow={
            setupRecoveryActive || setupRecoveryComplete
              ? "Recovery"
              : "Cleanup"
          }
          title={
            setupRecoveryActive || setupRecoveryComplete
              ? "Setup recovery"
              : "Replication teardown"
          }
          subtitle={
            setupRecoveryActive
              ? "Remove partial resources from an earlier setup attempt before retrying"
              : setupRecoveryComplete
                ? "Recovery complete. Replication setup is ready to retry"
                : "Inspect and remove only the replication resources created by this application"
          }
          danger
          action={
            <Button
              disabled={teardownInspecting}
              size="lg"
              variant="ghost"
              onClick={() => void inspectTeardown()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh resources
            </Button>
          }
        >
          {teardownInspection ? (
            <TeardownPanel
              inspection={teardownInspection}
              result={teardownResult}
              confirmed={confirmTeardown}
              busy={phase === "tearing-down"}
              checking={teardownInspecting}
              recheckAttempts={teardownRecheckAttempts}
              setupRecovery={setupRecoveryActive || setupRecoveryComplete}
              sourceProjectId={sourceProjectId}
              inspectionSqlCopied={copiedSql === "active-slot-inspection"}
              onCopyInspectionSql={(sql) =>
                void copySql("active-slot-inspection", sql)
              }
              onConfirmedChange={setConfirmTeardown}
              onReleaseActiveSlot={releaseActiveSlotAndTeardown}
              onTeardown={runTeardown}
            />
          ) : null}
        </Section>
      </div>
    ) : null;
  const progressTracker = (
    <MigrationProgress
      phase={phase}
      preflight={preflight}
      setup={setup}
      status={status}
      analyzeResult={analyzeResult}
      cutoverPre={cutoverPre}
      cutoverResult={cutoverResult}
      teardownInspection={teardownInspection}
      teardownResult={teardownResult}
      setupRecoveryActive={setupRecoveryActive}
      setupRecoveryComplete={setupRecoveryComplete}
    />
  );

  if (!sourceReady || !targetReady) {
    return (
      <div className={neon.page}>
        <div className={neon.pageContent}>
          <PageHeader
            title="Logical replication"
            subtitle="One-click logical replication setup between your source and target Neon projects"
            actions={authAction}
          />
          {workloadNotice}
          {pickerRow}
          {progressTracker}
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
                fetches their direct connection strings from the Neon API for
                your signed-in account.
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
          title="Logical replication"
          actions={authAction}
        />

        {workloadNotice}
        {pickerRow}
        {progressTracker}

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
                <span className="text-foreground">Advanced monitoring</span> runs Neon&apos;s
                recommended publisher + subscriber health queries on demand.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">05</span>
              <div>
                <span className="text-foreground">Analyze target</span> rebuilds
                optimizer statistics after the initial copy, before traffic
                reaches the target.
              </div>
            </li>
            <li className="flex gap-2">
              <span className="font-mono tnum text-[#00e599]">06</span>
              <div>
                <span className="text-foreground">Cutover</span> checks row
                counts, sequence drift, and slot activity, then drains lag,
                resets target sequences, verifies the target, and disables the
                subscription.
              </div>
            </li>
          </ol>
          <p className="mt-3 text-label text-[#9ca3af]">
            Each step also lives in Neon&apos;s docs:{" "}
            <a
              href="https://neon.com/docs/guides/logical-replication-neon-to-neon"
              target="_blank"
              rel="noreferrer"
              className="rounded-[2px] text-[#00e599] transition-colors duration-150 ease-out hover:text-[#7ff5cf] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Replicate from one Neon project to another
            </a>
            .
          </p>
        </details>

        {/* Step 1: Preflight */}
        <Section
          id="replication-preflight"
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
                  disabled={!authenticated || phase === "enabling"}
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
                {!authenticated && (
                  <p className="text-label text-[#f59e0b]">
                    Sign in with Neon to enable
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
            current
            danger={setupNeedsAttention}
            id="replication-provisioning"
            step="03"
            status={{
              state:
                phase === "setting-up"
                  ? "provisioning"
                  : setupNeedsAttention
                    ? "warning"
                    : "ready",
              label:
                phase === "setting-up"
                  ? "In progress"
                  : setupNeedsAttention
                    ? "Needs attention"
                    : setupRecoveryComplete
                      ? "Ready to retry"
                      : "Current",
            }}
            title="Provision publication + subscription"
            subtitle="Copies schema, creates publication on source, creates subscription on target"
            action={
              <div className="flex flex-col items-end gap-1.5">
                <Button
                  size="lg"
                  variant="white"
                  onClick={runSetup}
                  disabled={
                    !preflight.ok ||
                    selectedTables.length === 0 ||
                    phase === "setting-up"
                  }
                  title={
                    setupRequirementsRemaining > 0
                      ? "Complete the requirements shown below before starting replication."
                      : selectedTables.length === 0
                        ? "Select at least one table to replicate."
                      : undefined
                  }
                >
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
                {setupRequirementsRemaining > 0 ? (
                  <p className="text-label text-[#f59e0b]">
                    Complete the {setupRequirementsRemaining} requirement
                    {setupRequirementsRemaining === 1 ? "" : "s"} below to
                    continue.
                  </p>
                ) : selectedTables.length === 0 ? (
                  <p className="text-label text-[#f59e0b]">
                    Select at least one table to continue.
                  </p>
                ) : null}
              </div>
            }
          >
            <SetupRequirements
              preflight={preflight}
              recoveryActive={setupRecoveryActive}
              recoveryComplete={setupRecoveryComplete}
              onReviewPreflight={() =>
                document
                  .getElementById("replication-preflight")
                  ?.scrollIntoView({ behavior: "auto", block: "start" })
              }
              onReviewRecovery={() =>
                document
                  .getElementById("replication-teardown")
                  ?.scrollIntoView({ behavior: "auto", block: "start" })
              }
            />
            {setupClassifiedError ? (
              <div
                id="replication-setup-error"
                role="alert"
                tabIndex={-1}
              >
                <ClassifiedErrorBanner
                  classified={setupClassifiedError}
                  onAction={handleRecoveryAction}
                />
              </div>
            ) : null}
            <TableSelection
              ineligibleTables={preflight.source.unloggedTables ?? []}
              tables={preflight.source.tables}
              selectedTables={selectedTables}
              onChange={setSelectedTables}
            />
            <ol className="space-y-2 text-caption text-[#f3f4f6]">
              <li>
                <span className="font-mono text-[#00e599]">01</span> Copy extensions + table
                schemas to target (idempotent)
              </li>
              <li>
                <span className="font-mono text-[#00e599]">02</span> CREATE PUBLICATION{" "}
                <span className="font-mono">neon_advisor_pub</span> for the{" "}
                {selectedTables.length} selected table(s)
              </li>
              <li>
                <span className="font-mono text-[#00e599]">03</span> CREATE SUBSCRIPTION{" "}
                <span className="font-mono">neon_advisor_sub</span> on target with{" "}
                <span className="font-mono">copy_data = true</span>
              </li>
            </ol>
          </Section>
        )}
        {setupRecoveryActive || setupRecoveryComplete
          ? teardownSection
          : null}

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
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={() =>
                    document
                      .getElementById("replication-teardown")
                      ?.scrollIntoView({ behavior: "auto", block: "start" })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Teardown
                </Button>
              </div>
            }
          >
            {resumedSession ? (
              <div className="mb-3 rounded-[4px] border border-[#00e599]/30 bg-[#00e599]/[0.06] px-3 py-2 text-caption text-[#00e599]">
                Existing replication detected. Monitoring resumed after the
                page refresh; the database copy continued in Postgres. Do not
                run setup again.
              </div>
            ) : null}
            <div className="mb-3 rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] px-3 py-2 text-caption text-[#f59e0b]">
              Replication continues in Postgres after you leave or refresh this
              page. Refresh only reloads monitoring; it never restarts
              replication. Wait until every table is Ready and replication lag
              is near zero before cutover.
            </div>
            {status ? <StatusDetails s={status} /> : (
              <p className={`text-caption ${neon.muted}`}>Awaiting first status poll…</p>
            )}
          </Section>
        )}

        {/* Logical replication monitoring (Neon recommended health queries) */}
        {setup && (
          <Section
            eyebrow="Advanced monitoring"
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

        {/* Step 5: Rebuild optimizer statistics on the target */}
        {setup && (status?.state === "streaming" || cutoverResult) && (
          <Section
            step="05"
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

        {/* Step 6: Cutover */}
        {setup && status?.state === "streaming" && !cutoverResult && (
          <Section
            step="06"
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

        {/* Cutover result */}
        {cutoverResult && (
          <Section
            eyebrow="Status"
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
              sourceProjectId={sourceProjectId}
              sourceProjectName={sourceOverride?.projectName ?? sourceProjectId}
              sourcePgVersion={
                preflight?.source.pgVersion ?? sourceOverride?.pgVersion ?? null
              }
              targetProjectId={targetProjectId}
              targetProjectName={targetOverride?.projectName ?? targetProjectId}
              targetPgVersion={
                preflight?.target.pgVersion ?? targetOverride?.pgVersion ?? null
              }
            />
          </Section>
        )}

        {!setupRecoveryActive && !setupRecoveryComplete
          ? teardownSection
          : null}

        {classifiedError && !setupErrorShownInProvisioning ? (
          <ClassifiedErrorBanner
            classified={classifiedError}
            onAction={handleRecoveryAction}
          />
        ) : (
          !classifiedError &&
          error && (
            <div className="mt-4 rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-caption text-[#ef4444]">
              <span className="font-mono">error:</span> {error}
            </div>
          )
        )}

      </div>
    </div>
  );
}

function MigrationQuietStatus({
  state,
  label,
}: {
  state: MigrationQuietStatusState;
  label: string;
}) {
  const dotColor = {
    ready: "bg-[#00e599]",
    provisioning: "bg-[#00e599]",
    error: "bg-[#ef4444]",
    stopped: "bg-[#6b7280]",
    warning: "bg-[#f59e0b]",
  }[state];

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-label text-[#9ca3af]">
      <span
        aria-hidden
        className={`size-1.5 shrink-0 rounded-[1px] ${dotColor} ${
          state === "provisioning" ? "migration-status-breathe" : ""
        }`}
      />
      {label}
    </span>
  );
}

function MigrationProgress({
  phase,
  preflight,
  setup,
  status,
  analyzeResult,
  cutoverPre,
  cutoverResult,
  teardownInspection,
  teardownResult,
  setupRecoveryActive,
  setupRecoveryComplete,
}: {
  phase: Phase;
  preflight: ReplicationPreflight | null;
  setup: ReplicationSetupResult | null;
  status: ReplicationStatus | null;
  analyzeResult: AnalyzeTargetResult | null;
  cutoverPre: CutoverPreflight | null;
  cutoverResult: CutoverResult | null;
  teardownInspection: ReplicationResourceInspection | null;
  teardownResult: ReplicationTeardownResult | null;
  setupRecoveryActive: boolean;
  setupRecoveryComplete: boolean;
}) {
  const analyzeSucceeded = analyzeResult?.missingStatsAfter === 0;
  const cutoverStarted =
    phase === "cutover-preflight" ||
    phase === "cutover-ready" ||
    phase === "cutting-over" ||
    cutoverPre !== null ||
    cutoverResult !== null;
  const preflightHasNonEnablementBlocker = Boolean(
    preflight &&
      (!preflight.source.roleHasReplication ||
        preflight.source.tableCount === 0),
  );

  let currentStep = 1;
  let blocked = false;
  let summary = "Ready to run preflight";
  let detail: string | null = null;
  let summaryStatus: MigrationQuietStatusState = "ready";
  let summaryStatusLabel = "Current";

  if (cutoverResult) {
    currentStep = 6;
    summary = "Cutover complete";
    detail = "Traffic can move to the target";
    summaryStatusLabel = "Complete";
  } else if (setupRecoveryActive || setupRecoveryComplete) {
    currentStep = 3;
    const remainingRequirements = [
      ...(preflight && !preflight.ok ? ["preflight"] : []),
      ...(setupRecoveryActive ? ["setup recovery"] : []),
    ];
    blocked = remainingRequirements.length > 0;
    summary = "Provision replication";
    detail =
      setupRecoveryActive && phase === "tearing-down"
        ? "Removing partial resources before provisioning"
        : remainingRequirements.length > 0
          ? `${remainingRequirements.length} requirement${remainingRequirements.length === 1 ? "" : "s"} remaining · ${remainingRequirements.join(" + ")}`
          : "Recovery complete · Provisioning can be started again";
    summaryStatus =
      setupRecoveryActive && phase === "tearing-down"
        ? "provisioning"
        : blocked
          ? "warning"
          : "ready";
    summaryStatusLabel =
      setupRecoveryActive && phase === "tearing-down"
        ? "In progress"
        : blocked
          ? "Needs attention"
          : "Current";
  } else if (!preflight || phase === "preflighting") {
    currentStep = 1;
    if (phase === "preflighting") {
      summary = "Checking source and target";
      summaryStatus = "provisioning";
      summaryStatusLabel = "In progress";
    }
  } else if (!preflight.source.logicalReplicationEnabled) {
    currentStep = 2;
    blocked = preflightHasNonEnablementBlocker;
    summary =
      phase === "enabling"
        ? "Enabling logical replication"
        : blocked
          ? "Preflight needs attention"
          : "Logical replication is disabled";
    detail = blocked
      ? "Resolve the remaining preflight blockers before provisioning"
      : "Enable it on the source to continue";
    summaryStatus =
      phase === "enabling" ? "provisioning" : blocked ? "error" : "warning";
    summaryStatusLabel =
      phase === "enabling"
        ? "In progress"
        : blocked
          ? "Needs attention"
          : "Action required";
  } else if (!setup || phase === "setting-up") {
    currentStep = 3;
    blocked = !preflight.ok;
    summary =
      phase === "setting-up"
        ? "Provisioning replication"
        : blocked
          ? "Preflight needs attention"
          : "Ready to provision replication";
    detail = blocked
      ? "Resolve the preflight blockers before starting setup"
      : "Publication and subscription are next";
    summaryStatus =
      phase === "setting-up" ? "provisioning" : blocked ? "error" : "ready";
    summaryStatusLabel =
      phase === "setting-up"
        ? "In progress"
        : blocked
          ? "Needs attention"
          : "Current";
  } else if (status?.state !== "streaming" && !cutoverStarted) {
    currentStep = 4;
    blocked = status?.state === "stopped" || status?.state === "unknown";
    if (status?.state === "copying") {
      summary = "Initial copy in progress";
      detail = `${status.readyTables} of ${status.totalTables} tables ready · ${
        status.lagBytes === null ? "Lag unavailable" : `${formatBytes(status.lagBytes)} lag`
      }`;
      summaryStatus = "provisioning";
      summaryStatusLabel = "In progress";
    } else if (blocked) {
      summary = "Replication needs attention";
      detail = `Subscription state: ${status?.state ?? "unknown"}`;
      summaryStatus = status?.state === "stopped" ? "stopped" : "error";
      summaryStatusLabel = "Needs attention";
    } else {
      summary = "Waiting for replication status";
      detail = "The first status poll will report copy progress";
      summaryStatus = "stopped";
      summaryStatusLabel = "Waiting";
    }
  } else if (!analyzeSucceeded && !cutoverStarted) {
    currentStep = 5;
    blocked = Boolean(analyzeResult && !analyzeSucceeded);
    summary =
      phase === "analyzing-target"
        ? "Analyzing target"
        : blocked
          ? "Target analysis needs attention"
          : "Ready to analyze target";
    detail = blocked
      ? `${analyzeResult?.missingStatsAfter ?? 0} relation(s) still need statistics`
      : "Rebuild optimizer statistics before cutover";
    summaryStatus =
      phase === "analyzing-target" ? "provisioning" : blocked ? "warning" : "ready";
    summaryStatusLabel =
      phase === "analyzing-target"
        ? "In progress"
        : blocked
          ? "Needs attention"
          : "Current";
  } else {
    currentStep = 6;
    blocked = Boolean(cutoverPre && !cutoverPre.ok);
    if (phase === "cutover-preflight") {
      summary = "Checking cutover readiness";
      summaryStatus = "provisioning";
      summaryStatusLabel = "In progress";
    } else if (phase === "cutting-over") {
      summary = "Cutover in progress";
      summaryStatus = "provisioning";
      summaryStatusLabel = "In progress";
    } else if (blocked) {
      summary = "Cutover needs attention";
      detail = `${cutoverPre?.blockers.length ?? 0} blocker(s) must be resolved`;
      summaryStatus = "error";
      summaryStatusLabel = "Needs attention";
    } else if (cutoverPre?.ok) {
      summary = "Ready to cut over";
      detail = "Preflight checks passed";
    } else {
      summary = "Ready for cutover preflight";
      detail = "Check lag, row counts, sequences, and slot activity";
    }
  }

  const allCompleted = Boolean(cutoverResult);
  const stepStates = MIGRATION_STEPS.map<MigrationStepState>((_, index) => {
    const step = index + 1;
    if (allCompleted || step < currentStep) return "completed";
    if (step === currentStep) return blocked ? "blocked" : "current";
    return "upcoming";
  });

  const cleanupState = (() => {
    if (setupRecoveryActive || setupRecoveryComplete) return null;
    if (phase === "tearing-down") {
      return {
        state: "provisioning" as const,
        label: "Tearing down",
        detail: "Removing application-owned replication resources",
      };
    }
    if (teardownResult && !teardownResult.cleanupComplete) {
      return {
        state: "error" as const,
        label: "Needs attention",
        detail: "Cleanup is incomplete. Review the remaining resources below",
      };
    }
    if (teardownResult?.cleanupComplete) {
      return {
        state: "ready" as const,
        label: "Cleanup complete",
        detail: "No application-owned replication resources remain",
      };
    }
    if (cutoverResult) {
      return {
        state: "warning" as const,
        label: "Rollback window",
        detail:
          "Keep the source and replication resources available for 24–48 hours before teardown",
      };
    }
    if (setup || teardownInspection?.anyResourceExists) {
      return {
        state: "stopped" as const,
        label: "Cleanup available",
        detail: "Teardown remains separate from the six migration steps",
      };
    }
    return null;
  })();

  return (
    <nav
      aria-label="Migration progress"
      className="mb-5 rounded-[4px] border border-[#262727] bg-[#131414] px-4 py-4 sm:px-5"
    >
      <div
        aria-live="polite"
        className="flex flex-wrap items-start justify-between gap-2"
      >
        <div>
          <p className="font-mono text-caption text-foreground">
            Step {currentStep} of {MIGRATION_STEPS.length}
            <span className="text-[#6b7280]"> · </span>
            {summary}
          </p>
          {detail ? (
            <p className="mt-1 font-mono text-label tabular-nums text-[#9ca3af]">
              {detail}
            </p>
          ) : null}
        </div>
        <MigrationQuietStatus
          label={summaryStatusLabel}
          state={summaryStatus}
        />
      </div>

      <div className="relative mt-5">
        <span
          aria-hidden
          className="absolute left-[8.333%] right-[8.333%] top-[5px] h-px bg-[#262727]"
        />
        <ol className="relative grid grid-cols-6">
          {MIGRATION_STEPS.map((label, index) => {
            const state = stepStates[index];
            const isCurrent = index + 1 === currentStep;
            const markerClass = {
              completed: "border-[#00e599] bg-[#00e599]",
              current: "border-[#00e599] bg-[#131414] shadow-[0_0_0_3px_rgba(0,229,153,0.10)]",
              blocked: "border-[#f59e0b] bg-[#f59e0b]",
              upcoming: "border-[#4b4d4d] bg-[#131414]",
            }[state];
            const labelClass = {
              completed: "text-[#9ca3af]",
              current: "font-medium text-foreground",
              blocked: "font-medium text-foreground",
              upcoming: "text-[#6b7280]",
            }[state];

            return (
              <li
                aria-current={isCurrent ? "step" : undefined}
                className="relative flex min-w-0 flex-col items-center px-0.5 text-center"
                key={label}
              >
                <span
                  aria-hidden
                  className={`relative z-10 size-[11px] rounded-[1px] border transition-[transform,opacity,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${markerClass} ${
                    isCurrent ? "scale-110" : "scale-100"
                  }`}
                />
                <span
                  className={`mt-2 text-label leading-[1.35] transition-[color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isCurrent ? "block" : "hidden sm:block"
                  } ${labelClass}`}
                >
                  {label}
                </span>
                <span className="sr-only sm:not-sr-only sm:mt-1">
                  <MigrationQuietStatus
                    label={
                      state === "completed"
                        ? "Complete"
                        : state === "blocked"
                          ? "Needs attention"
                          : state === "current"
                            ? "Current"
                            : "Upcoming"
                    }
                    state={
                      state === "completed" || state === "current"
                        ? "ready"
                        : state === "blocked"
                          ? "warning"
                          : "stopped"
                    }
                  />
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {setupRecoveryActive || setupRecoveryComplete ? (
        <div className="mt-4 flex items-start justify-between gap-3 border-t border-[#262727] pt-3">
          <div>
            <p className="text-caption font-medium text-foreground">
              Setup recovery
            </p>
            <p className="mt-0.5 text-label text-[#9ca3af]">
              {setupRecoveryComplete
                ? "Complete · Step 3 is ready to retry"
                : "Required · Complete the cleanup steps below before retrying"}
            </p>
          </div>
          <MigrationQuietStatus
            label={
              setupRecoveryComplete
                ? "Complete"
                : phase === "tearing-down"
                  ? "Cleaning up"
                  : "Needs attention"
            }
            state={
              setupRecoveryComplete
                ? "ready"
                : phase === "tearing-down"
                  ? "provisioning"
                  : "warning"
            }
          />
        </div>
      ) : null}

      {cleanupState ? (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 border-t border-[#262727] pt-3">
          <div>
            <p className="text-caption font-medium text-foreground">
              Replication cleanup
            </p>
            <p className="mt-0.5 max-w-2xl text-label leading-[1.5] text-[#9ca3af]">
              {cleanupState.detail}
            </p>
          </div>
          <MigrationQuietStatus
            label={cleanupState.label}
            state={cleanupState.state}
          />
        </div>
      ) : null}
    </nav>
  );
}

function Section({
  id,
  step,
  eyebrow,
  title,
  subtitle,
  action,
  children,
  current,
  status,
  danger,
}: {
  id?: string;
  step?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  current?: boolean;
  status?: {
    state: MigrationQuietStatusState;
    label: string;
  };
  danger?: boolean;
}) {
  return (
    <section
      aria-current={current ? "step" : undefined}
      id={id}
      className={`mb-5 rounded-[4px] border p-5 ${
        danger
          ? "border-[#f59e0b]/40 bg-[#f59e0b]/[0.04]"
          : current
            ? "border-[#00e599]/35 bg-[#00e599]/[0.025]"
          : "border-[#262727] bg-[#131414]"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          {(step || eyebrow) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-micro uppercase tracking-[0.08em] text-[#00e599]">
                {step ? `Step ${step}` : eyebrow}
              </span>
              {status ? (
                <MigrationQuietStatus
                  label={status.label}
                  state={status.state}
                />
              ) : null}
            </div>
          )}
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

function SetupRequirements({
  preflight,
  recoveryActive,
  recoveryComplete,
  onReviewPreflight,
  onReviewRecovery,
}: {
  preflight: ReplicationPreflight;
  recoveryActive: boolean;
  recoveryComplete: boolean;
  onReviewPreflight: () => void;
  onReviewRecovery: () => void;
}) {
  const requirements = [
    ...(!preflight.ok
      ? [
          {
            id: "preflight",
            complete: false,
            title: "Resolve preflight blockers",
            detail:
              preflight.blockers.length > 0
                ? `${preflight.blockers.length} blocker${preflight.blockers.length === 1 ? "" : "s"} reported in Step 1`
                : "Step 1 must pass before provisioning",
            action: "Review preflight",
            onAction: onReviewPreflight,
          },
        ]
      : []),
    ...(recoveryActive || recoveryComplete
      ? [
          {
            id: "recovery",
            complete: recoveryComplete,
            title: "Clean up partial setup resources",
            detail: recoveryComplete
              ? "Cleanup complete. Step 3 is ready to retry"
              : "Resources from an earlier attempt must be removed",
            action: recoveryComplete ? null : "Review cleanup",
            onAction: onReviewRecovery,
          },
        ]
      : []),
  ];

  if (requirements.length === 0) return null;

  const remaining = requirements.filter(
    (requirement) => !requirement.complete,
  ).length;

  return (
    <div
      className={`mb-4 rounded-[4px] border p-3 ${
        remaining > 0
          ? "border-[#f59e0b]/35 bg-[#f59e0b]/[0.06]"
          : "border-[#00e599]/35 bg-[#00e599]/[0.06]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-caption font-medium text-foreground">
            {remaining > 0
              ? "Before Step 3 can continue"
              : "Step 3 requirements complete"}
          </p>
          <p className="mt-0.5 text-label text-[#9ca3af]">
            {remaining > 0
              ? `${remaining} requirement${remaining === 1 ? "" : "s"} remaining`
              : "Provisioning can be started again"}
          </p>
        </div>
        <MigrationQuietStatus
          label={remaining > 0 ? "Needs attention" : "Ready"}
          state={remaining > 0 ? "warning" : "ready"}
        />
      </div>

      <ul className="mt-3 divide-y divide-[#262727] border-t border-[#262727]">
        {requirements.map((requirement) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 py-2.5"
            key={requirement.id}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              {requirement.complete ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[#00e599]" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#f59e0b]" />
              )}
              <div>
                <p className="text-caption text-foreground">
                  {requirement.title}
                </p>
                <p className="mt-0.5 text-label text-[#9ca3af]">
                  {requirement.detail}
                </p>
              </div>
            </div>
            {requirement.action ? (
              <Button
                onClick={requirement.onAction}
                size="xs"
                type="button"
                variant="ghost"
              >
                {requirement.action}
                <ArrowRight className="size-3" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableSelection({
  tables,
  selectedTables,
  ineligibleTables,
  onChange,
}: {
  tables: string[];
  selectedTables: string[];
  ineligibleTables: string[];
  onChange: (tables: string[]) => void;
}) {
  const selected = new Set(selectedTables);
  const ineligible = new Set(ineligibleTables);
  const eligibleTables = tables.filter((table) => !ineligible.has(table));
  return (
    <div className="mb-4 rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-caption font-medium text-foreground">
            Tables to replicate
          </p>
          <p className="mt-0.5 text-label text-[#9ca3af]">
            {selectedTables.length} of {tables.length} selected
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            onClick={() => onChange(eligibleTables)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Select all
          </Button>
          <Button
            onClick={() => onChange([])}
            size="xs"
            type="button"
            variant="ghost"
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="mt-3 grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">
        {tables.map((table) => {
          const unavailable = ineligible.has(table);
          return (
            <label
              className={`flex items-center gap-2 rounded-[3px] px-2 py-1.5 text-label ${
                unavailable
                  ? "cursor-not-allowed text-[#9ca3af]"
                  : "cursor-pointer text-foreground hover:bg-[#1a1b1b]"
              }`}
              key={table}
              title={
                unavailable
                  ? "Unlogged tables cannot use logical replication"
                  : table
              }
            >
              <input
                checked={selected.has(table)}
                className="size-3.5 accent-[#00e599]"
                disabled={unavailable}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selectedTables, table]
                      : selectedTables.filter((item) => item !== table),
                  )
                }
                type="checkbox"
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {table}
              </span>
              {unavailable ? (
                <span className="shrink-0 text-micro uppercase tracking-[0.06em] text-[#f59e0b]">
                  Unlogged
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PreflightDetails({ p }: { p: ReplicationPreflight }) {
  const tablesWithoutReplicaIdentity =
    p.source.tablesWithoutReplicaIdentity ?? p.source.tablesWithoutPK;
  const coveredNoPkTables =
    p.source.tablesWithoutPK.length - tablesWithoutReplicaIdentity.length;

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
        <KV k="User tables" v={String(p.source.tableCount)} />
        {(p.source.unloggedTables?.length ?? 0) > 0 && (
          <KV
            k="Unlogged tables"
            v={`${p.source.unloggedTables?.length ?? 0} excluded`}
            tone="warn"
          />
        )}
        {tablesWithoutReplicaIdentity.length > 0 && (
          <KV
            k="Missing replica identity"
            v={`${tablesWithoutReplicaIdentity.length} table${tablesWithoutReplicaIdentity.length === 1 ? "" : "s"}`}
            tone="warn"
          />
        )}
        {coveredNoPkTables > 0 && (
          <KV
            k="No-PK tables covered"
            v={`${coveredNoPkTables} (FULL or unique index)`}
            tone="ok"
          />
        )}
        {tablesWithoutReplicaIdentity.length > 0 && (
          <div className="mt-3 border-t border-[#262727] pt-3">
            <p className="text-label text-[#9ca3af]">Affected tables</p>
            <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto">
              {tablesWithoutReplicaIdentity.map((table) => (
                <li
                  className="truncate font-mono text-label text-[#f59e0b]"
                  key={table}
                  title={table}
                >
                  {table}
                </li>
              ))}
            </ul>
          </div>
        )}
        {p.source.tables?.length > 0 && (
          <details className="mt-3 border-t border-[#262727] pt-3">
            <summary className="cursor-pointer text-label text-[#9ca3af] hover:text-foreground">
              View identified tables
            </summary>
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
              {p.source.tables.map((table) => (
                <p
                  className="truncate font-mono text-label text-foreground"
                  key={table}
                  title={table}
                >
                  {table}
                </p>
              ))}
            </div>
          </details>
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
  const lagText = s.lagBytes === null ? "—" : formatBytes(s.lagBytes);

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
          value={`${s.readyTables} of ${s.totalTables} Ready`}
          tone={s.initialReplicationComplete ? "ok" : "warn"}
        />
      </div>

      <div
        className={`mb-4 rounded-[4px] border p-3 ${
          s.initialReplicationComplete
            ? "border-[#00e599]/40 bg-[#00e599]/[0.06]"
            : "border-[#f59e0b]/40 bg-[#f59e0b]/[0.06]"
        }`}
      >
        {s.initialReplicationComplete ? (
          <p className="flex items-center gap-2 text-caption text-[#00e599]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Initial replication complete — every subscribed table is Ready.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-caption font-medium text-foreground">
                {s.readyTables} of {s.totalTables} tables Ready.
              </p>
              <div
                aria-label="Initial replication in progress"
                aria-valuetext={`${s.readyTables} of ${s.totalTables} tables Ready`}
                className="mt-2 h-1.5 overflow-hidden rounded-[2px] bg-[#262727]"
                role="progressbar"
              >
                <div className="replication-indeterminate-bar h-full w-1/3 rounded-[2px] bg-[#00e599]" />
              </div>
            </div>
            {s.activeCopies.length > 0 ? (
              <div className="space-y-2">
                {s.activeCopies.map((copy) => (
                  <div
                    className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] px-3 py-2"
                    key={copy.tableName}
                  >
                    <p className="text-caption text-foreground">
                      Copying{" "}
                      <span className="font-mono">{copy.tableName}</span>
                    </p>
                    <p className="mt-1 text-label text-[#9ca3af]">
                      Current table copy:{" "}
                      <span className="font-mono text-[#f3f4f6]">
                        {formatBytes(copy.bytesProcessed)}
                      </span>{" "}
                      ·{" "}
                      <span className="font-mono text-[#f3f4f6]">
                        {formatRows(copy.tuplesProcessed)}
                      </span>{" "}
                      rows processed
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-label text-[#d6a44c]">
                Waiting for the next table copy update.
              </p>
            )}
            <p className="text-label text-[#9ca3af]">
              These values describe each active table copy only. PostgreSQL
              does not normally report a total byte count for logical
              replication callbacks, so no percentage or migration-total
              estimate is shown.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="mb-2 text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
          Per-table state
        </p>
        <div className="grid gap-1 text-label">
          {s.perTable.length === 0 ? (
            <p className={neon.muted}>No tables in subscription yet.</p>
          ) : (
            s.perTable.map((t) => (
              <div key={t.table} className="flex items-center justify-between gap-3">
                <span className="font-mono text-foreground">{t.table}</span>
                <span
                  className={
                    t.state === "Ready"
                      ? "text-[#00e599]"
                      : t.state === "Synchronized"
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatRows(rows: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: rows >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(rows);
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
  const readyTables = m.subscriber.filter(
    (table) => table.tableStatus === "Ready",
  ).length;
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
          <div>
            <p>
              <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
              Initial replication still in progress — {readyTables} of{" "}
              {m.subscriber.length} tables Ready.
            </p>
            <p className="mt-1 pl-5 text-label text-[#d6a44c]">
              Large databases can take minutes to hours. You can safely leave
              or refresh this page; replication continues in Postgres. Wait
              until every table is Ready and lag is near zero before cutover.
            </p>
          </div>
        )}
      </div>

      {/* Subscriber */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
            Subscriber — per-table state
          </p>
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
          worker. Init copy ended at is a historical marker (
          <span className="font-mono">srsublsn</span>) — for
          live replication position, see the publisher panel below.
        </p>
      </div>

      {/* Publisher */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
            Publisher — LSN distance per slot
          </p>
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

function TeardownPanel({
  inspection,
  result,
  confirmed,
  busy,
  checking,
  recheckAttempts,
  setupRecovery,
  sourceProjectId,
  inspectionSqlCopied,
  onCopyInspectionSql,
  onConfirmedChange,
  onReleaseActiveSlot,
  onTeardown,
}: {
  inspection: ReplicationResourceInspection;
  result: ReplicationTeardownResult | null;
  confirmed: boolean;
  busy: boolean;
  checking: boolean;
  recheckAttempts: number;
  setupRecovery: boolean;
  sourceProjectId: string | null;
  inspectionSqlCopied: boolean;
  onCopyInspectionSql: (sql: string) => void;
  onConfirmedChange: (confirmed: boolean) => void;
  onReleaseActiveSlot: () => void;
  onTeardown: () => void;
}) {
  const stateColor = (state: string) =>
    state === "absent"
      ? "text-[#9ca3af]"
      : state === "active"
        ? "text-[#ef4444]"
        : "text-[#f59e0b]";
  const activeOrphan =
    inspection.subscription.state === "absent" &&
    inspection.slot.state === "active";
  const slotInspectionSql = `SELECT slot_name, active, active_pid
FROM pg_replication_slots
WHERE slot_name = 'neon_advisor_sub';`;
  const backendInspectionSql = inspection.slot.activePid
    ? `SELECT pid, backend_type, application_name, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE pid = ${inspection.slot.activePid};`
    : null;
  const sourceInspectionSql = backendInspectionSql
    ? `${slotInspectionSql}\n\n${backendInspectionSql}`
    : slotInspectionSql;

  return (
    <div className="space-y-4">
      <div className="rounded-[4px] border border-[#ef4444]/40 bg-[#ef4444]/[0.08] p-3">
        <p className="flex items-center gap-2 text-caption font-medium text-[#ef4444]">
          <AlertOctagon className="h-3.5 w-3.5" />
          {setupRecovery
            ? "Cleanup permanently removes the partial replication resources from this setup attempt."
            : "Teardown permanently stops replication and removes the replication-based rollback path."}
        </p>
        {!setupRecovery ? (
          <p className="mt-2 text-label leading-[1.55] text-[#f3f4f6]">
            Keep the source project, subscription, publication, and replication
            slot for 24–48 hours after cutover when possible. Teardown only
            after the target is stable and you no longer need source rollback.
          </p>
        ) : null}
      </div>

      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="mb-3 text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
          Exact resources
        </p>
        <dl className="space-y-2 text-caption">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#9ca3af]">Target subscription</dt>
            <dd className="text-right">
              <span className="font-mono text-foreground">
                {inspection.subscription.name}
              </span>
              <span
                className={`ml-2 ${stateColor(inspection.subscription.state)}`}
              >
                {inspection.subscription.state}
                {inspection.subscription.state === "present"
                  ? inspection.subscription.enabled
                    ? " · enabled"
                    : " · disabled"
                  : ""}
              </span>
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#9ca3af]">Source publication</dt>
            <dd className="text-right">
              <span className="font-mono text-foreground">
                {inspection.publication.name}
              </span>
              <span
                className={`ml-2 ${stateColor(inspection.publication.state)}`}
              >
                {inspection.publication.state}
              </span>
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#9ca3af]">Source replication slot</dt>
            <dd className="text-right">
              <span className="font-mono text-foreground">
                {inspection.slot.name ?? "—"}
              </span>
              <span className={`ml-2 ${stateColor(inspection.slot.state)}`}>
                {inspection.slot.state}
              </span>
            </dd>
          </div>
          {inspection.subscription.publications.length > 0 ? (
            <div className="flex items-start justify-between gap-4 border-t border-[#262727] pt-2">
              <dt className="text-[#9ca3af]">Recorded publication list</dt>
              <dd className="text-right font-mono text-foreground">
                {inspection.subscription.publications.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      {activeOrphan ? (
        <div className="space-y-3 rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] p-3">
          <p className="flex items-center gap-2 text-caption font-medium text-[#00e599]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Replication subscription removed
          </p>

          <div className="border-t border-[#f59e0b]/25 pt-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[#f59e0b]/50 font-mono text-micro text-[#f59e0b]">
                  2
                </span>
                <div>
                  <p className="text-caption font-medium text-foreground">
                    Release active source session
                  </p>
                  <p className="mt-1 text-label leading-[1.55] text-[#f3f4f6]">
                    PostgreSQL reports{" "}
                    <span className="font-mono">neon_advisor_sub</span> active
                    {inspection.slot.activePid ? (
                      <>
                        {" "}
                        on PID{" "}
                        <span className="font-mono">
                          {inspection.slot.activePid}
                        </span>
                      </>
                    ) : null}
                    . Inspect and end the owning session on the source before
                    cleanup can continue.
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[#f59e0b]/40 px-2 py-0.5 text-micro uppercase tracking-[0.08em] text-[#f59e0b]">
                Required
              </span>
            </div>
          </div>

          <div>
            <p className="tag mb-1">Read-only source inspection</p>
            <pre className="overflow-x-auto rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-2 font-mono text-micro text-[#f3f4f6]">
              {sourceInspectionSql}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => onCopyInspectionSql(sourceInspectionSql)}
              size="sm"
              variant="outline"
            >
              {inspectionSqlCopied ? (
                <Check className="h-3.5 w-3.5 text-[#00e599]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {inspectionSqlCopied ? "Copied" : "Copy inspection SQL"}
            </Button>
            {sourceProjectId ? (
              <Button
                onClick={() =>
                  window.open(
                    `https://console.neon.tech/app/projects/${sourceProjectId}/sql-editor`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                size="sm"
                variant="outline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open source SQL editor
              </Button>
            ) : null}
            <p className="text-label text-[#9ca3af]">
              {recheckAttempts < 10
                ? `Automatic check ${recheckAttempts + 1} of 10`
                : "Automatic rechecks stopped after the timeout."}
            </p>
          </div>

          <p className="text-label leading-[1.55] text-[#f3f4f6]">
            Confirm the PID belongs to this replication attempt before ending
            it. The advisor calls{" "}
            <span className="font-mono">pg_terminate_backend</span> only after
            this explicit confirmation and never force-drops an active slot.
          </p>

          <div className="border-t border-[#f59e0b]/25 pt-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[#9ca3af]/40 font-mono text-micro text-[#9ca3af]">
                  3
                </span>
                <div>
                  <p className="text-caption font-medium text-foreground">
                    Remove source resources
                  </p>
                  <p className="mt-1 font-mono text-label text-[#9ca3af]">
                    neon_advisor_sub · neon_advisor_pub
                  </p>
                </div>
              </div>
              <span className="text-micro uppercase tracking-[0.08em] text-[#f59e0b]">
                Waiting
              </span>
            </div>
            <Button
              className="mt-3"
              disabled={!confirmed || checking || busy}
              onClick={onReleaseActiveSlot}
              size="lg"
              variant="outline"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              {busy ? "Ending session…" : "End session and finish cleanup"}
            </Button>
          </div>
        </div>
      ) : inspection.slot.state === "active" ? (
        <div className="rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] px-3 py-2 text-caption text-[#f59e0b]">
          PostgreSQL reports this slot active. Teardown will first disable and
          remove the existing subscription, then wait briefly for its backend
          to exit. It will never terminate the process or force-drop the slot.
        </div>
      ) : null}

      {inspection.anyResourceExists ? (
        <div className="space-y-3">
          <label className="flex cursor-pointer items-start gap-2 rounded-[4px] border border-[#262727] bg-[#0c0d0d] px-3 py-2 text-caption text-foreground">
            <input
              checked={confirmed}
              className="mt-0.5 size-3.5 accent-[#ef4444]"
              onChange={(event) => onConfirmedChange(event.target.checked)}
              type="checkbox"
            />
            <span>
              {activeOrphan
                ? `I understand that cleanup will end the app-owned replication session${inspection.slot.activePid ? ` on PID ${inspection.slot.activePid}` : ""}, then remove its slot and publication.`
                : setupRecovery
                ? "I understand that cleanup permanently removes these partial replication resources."
                : "I understand that teardown permanently stops replication and removes the replication-based rollback path."}
            </span>
          </label>
          {!activeOrphan ? (
            <Button
              disabled={!confirmed || busy}
              onClick={onTeardown}
              size="lg"
              variant="destructive"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Tearing down…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {setupRecovery
                    ? "Clean up setup resources"
                    : "Permanently stop replication"}
                </>
              )}
            </Button>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div
            className={`rounded-[4px] border px-3 py-2 text-caption ${
              result.cleanupComplete
                ? "border-[#00e599]/40 bg-[#00e599]/[0.08] text-[#00e599]"
                : result.replicationStopped
                  ? "border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] text-[#f59e0b]"
                  : "border-[#ef4444]/40 bg-[#ef4444]/[0.08] text-[#ef4444]"
            }`}
          >
            {result.cleanupComplete
              ? setupRecovery
                ? "Setup recovery complete. No partial resources remain; Step 3 is ready to retry."
                : "Teardown verified. No application-owned replication resources remain."
              : result.replicationStopped
                ? `Replication subscription removed. Source cleanup is incomplete. Remaining resources: ${result.remainingResources.join(", ")}.`
                : `Replication is not stopped. Remaining resources: ${result.remainingResources.join(", ")}.`}
          </div>
          <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
            <p className="mb-2 text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
              Teardown steps
            </p>
            <div className="space-y-2">
              {result.steps.map((step) => (
                <div
                  className="flex items-start justify-between gap-4 border-b border-[#262727]/60 pb-2 text-label last:border-0 last:pb-0"
                  key={step.id}
                >
                  <div>
                    <p className="text-foreground">{step.label}</p>
                    <p className="mt-0.5 text-[#9ca3af]">{step.detail}</p>
                    <p className="mt-0.5 font-mono text-[#9ca3af]">
                      {step.resource}
                    </p>
                  </div>
                  <span
                    className={
                      step.status === "failed"
                        ? "text-[#ef4444]"
                        : step.status === "waiting"
                          ? "text-[#f59e0b]"
                        : step.status === "removed"
                          ? "text-[#00e599]"
                          : "text-[#9ca3af]"
                    }
                  >
                    {step.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {result.recoveryInstructions.length > 0 ? (
            <div className="rounded-[4px] border border-[#f59e0b]/40 bg-[#f59e0b]/[0.08] p-3">
              <p className="text-caption font-medium text-[#f59e0b]">
                Recovery for remaining resources
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-label text-[#f3f4f6]">
                {result.recoveryInstructions.map((instruction) => (
                  <li key={instruction}>{instruction}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
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
  sourceProjectId,
  sourceProjectName,
  sourcePgVersion,
  targetProjectId,
  targetProjectName,
  targetPgVersion,
}: {
  r: CutoverResult;
  onCopyConn: () => void;
  copiedConn: boolean;
  sourceProjectId: string | null;
  sourceProjectName: string | null;
  sourcePgVersion: number | null;
  targetProjectId: string | null;
  targetProjectName: string | null;
  targetPgVersion: number | null;
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
      <div className="px-4 py-2 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[8px] border border-[#00e599]/25 bg-[#00e599]/10 text-[#00e599]">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-heading font-medium text-foreground">
          Migration successful
        </h3>
        <p className="mt-1 text-caption text-[#9ca3af]">
          {sourcePgVersion && targetPgVersion ? (
            <>
              Your database has been migrated from{" "}
              <span className="font-mono text-foreground">
                PG {sourcePgVersion}
              </span>{" "}
              to{" "}
              <span className="font-mono text-[#00e599]">
                PG {targetPgVersion}
              </span>
              .
            </>
          ) : (
            "Logical replication cutover completed successfully."
          )}
        </p>
      </div>

      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-4">
        <p className="tag mb-3">Migration summary</p>
        <dl className="space-y-2 text-caption">
          {[
            ["Method", "Logical replication"],
            [
              "Source version",
              sourcePgVersion ? `PG ${sourcePgVersion}` : "—",
            ],
            [
              "Target version",
              targetPgVersion ? `PG ${targetPgVersion}` : "—",
            ],
            ["Source project", sourceProjectName ?? "—"],
            ["Target project", targetProjectName ?? "—"],
          ].map(([label, value]) => (
            <div className="flex items-start justify-between gap-6" key={label}>
              <dt className="text-[#9ca3af]">{label}</dt>
              <dd
                className={
                  label === "Target version"
                    ? "text-right font-mono text-[#00e599]"
                    : "text-right text-foreground"
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* New primary banner */}
      <div className="rounded-[4px] border border-[#00e599]/40 bg-[#00e599]/[0.06] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="tag text-[#00e599]">New primary connection string</p>
          <Button size="lg" variant="ghost" onClick={onCopyConn}>
            {copiedConn ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-[#00e599]" />
                Full connection string copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy full connection string
              </>
            )}
          </Button>
        </div>
        <p className="break-all font-mono text-label text-[#f3f4f6]">
          {r.newPrimaryConnectionString.replace(/:([^:@]+)@/, ":••••••@")}
        </p>
        <p className="mt-2 text-label text-[#9ca3af]">
          The password is hidden in this preview. Copying includes the complete
          connection string.
        </p>
        {targetProjectId && (
          <p className="mt-1 text-label text-[#9ca3af]">
            The Console&apos;s Connect button will show this project&apos;s connection
            strings for every role and database, plus a one-click Connect
            modal you can copy into your app.
          </p>
        )}
        {(sourceProjectId || targetProjectId) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-[#00e599]/15 pt-3 text-caption">
            {sourceProjectId && (
              <a
                href={`https://console.neon.tech/app/projects/${sourceProjectId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[2px] text-[#9ca3af] transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50"
              >
                Source project
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {targetProjectId && (
              <a
                href={`https://console.neon.tech/app/projects/${targetProjectId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-[2px] text-[#00e599] transition-colors duration-150 ease-out hover:text-[#7ff5cf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50"
              >
                Target project
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Step log */}
      <div className="rounded-[4px] border border-[#262727] bg-[#0c0d0d] p-3">
        <p className="tag mb-2">Cutover timeline</p>
        <div className="space-y-1.5">
          {r.steps.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 text-caption"
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className={`font-mono ${statusColor[s.status] ?? ""}`}>
                  {s.status === "ok"
                    ? "✓"
                    : s.status === "failed"
                      ? "✗"
                      : "·"}
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
        <span className="text-micro uppercase tracking-[0.08em] text-[#9ca3af]">
          {label}
        </span>
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
