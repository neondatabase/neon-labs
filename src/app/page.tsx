"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  CircleCheck,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  Zap,
} from "lucide-react";
import { useAssessment } from "@/components/AssessmentProvider";
import { TargetProjectPicker } from "@/components/TargetProjectPicker";
import { PageHeader, SelectCard, neon } from "@/components/ui";
import { NEON_SUPPORTED_VERSIONS, type PgMajorVersion } from "@/lib/types";
import { changesForUpgrade } from "@/lib/version-changes";
import {
  getSourceOverride,
  getTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Notice,
  NoticeActions,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
} from "@/components/ui/notice";

interface ProjectEntry {
  id: string;
  role: "source" | "target";
  pgVersion: number | null;
  hasConnection: boolean;
}

interface ProjectsResponse {
  orgName: string | null;
  orgId: string | null;
  projects: ProjectEntry[];
}

type Method = "live" | "upload";

type StepId = "method" | "source" | "bundle" | "sourceVersion" | "target";

interface WizardStep {
  id: StepId;
  label: string;
  heading: string;
  subtitle: string;
  valid: boolean;
}

const LATEST_VERSION = NEON_SUPPORTED_VERSIONS[NEON_SUPPORTED_VERSIONS.length - 1];

const RELEASE_NOTE: Record<number, string> = {
  14: "Released Sep 2021",
  15: "Released Oct 2022",
  16: "Released Sep 2023",
  17: "Released Sep 2024",
  18: "Released Sep 2025 · current",
};


export default function NewAssessmentPage() {
  const { setAssessment } = useAssessment();
  const router = useRouter();
  const [cfg, setCfg] = useState<ProjectsResponse | null>(null);
  const [method, setMethod] = useState<Method>("live");
  const [sourceVersion, setSourceVersion] = useState<PgMajorVersion>(14);
  const [targetVersion, setTargetVersion] = useState<PgMajorVersion>(17);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetOverride, setTargetOverrideState] = useState<TargetOverride | null>(null);
  const [sourceOverride, setSourceOverrideState] = useState<TargetOverride | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    setTargetOverrideState(getTargetOverride());
    setSourceOverrideState(getSourceOverride());
  }, []);

  useEffect(() => {
    fetch("/api/neon/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ProjectsResponse | null) => setCfg(c))
      .catch(() => setCfg(null));
  }, []);

  const sourceProject = cfg?.projects.find((p) => p.role === "source");
  const sourceReady = Boolean(
    sourceOverride?.connectionUri || sourceProject?.hasConnection,
  );

  // Effective source PG version:
  //   - Live mode: comes from the picked source project (its real pg_version
  //     from the Neon API). Falls back to 14 if we can't determine it yet
  //     (no source picked, no env metadata).
  //   - Upload mode: comes from the user's source-version selector card,
  //     which the bundle metadata.json may later override server-side.
  // This drives target-version "Not an upgrade" gating, the preview, and
  // the eventual API call.
  /* Live mode reads the source's real major from the Neon API, either from
     the picked project or the env default. Guessing here let a no-op upgrade
     pass validation and produced a "PG 17 to PG 17" assessment. */
  const detectedSourceVersion =
    method === "live"
      ? ((sourceOverride?.pgVersion as PgMajorVersion | undefined) ??
        (sourceProject?.pgVersion as PgMajorVersion | null) ??
        null)
      : sourceVersion;
  const sourceVersionKnown = detectedSourceVersion !== null;
  const effectiveSourceVersion: PgMajorVersion =
    (detectedSourceVersion as PgMajorVersion | null) ?? 14;

  // Auto-bump target if it's no longer greater than effective source, e.g.
  // when the user picks a PG17 source after defaulting to PG17 target.
  useEffect(() => {
    if (method === "live" && targetVersion <= effectiveSourceVersion) {
      setTargetVersion(
        Math.min(18, effectiveSourceVersion + 1) as PgMajorVersion,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSourceVersion, method]);

  const atLatest = sourceVersionKnown && effectiveSourceVersion >= LATEST_VERSION;
  const previewChanges = changesForUpgrade(
    effectiveSourceVersion,
    targetVersion,
  );

  const steps = useMemo(() => {
    const list: WizardStep[] = [
      {
        id: "method",
        label: "Method",
        heading: "How do you want to provide your data?",
        subtitle:
          "Live introspection is fastest. Upload is for environments where you can't share a connection string.",
        valid: true,
      },
    ];
    if (method === "live") {
      list.push({
        id: "source",
        label: "Source project",
        heading: "Source project",
        subtitle:
          "Pick which Neon project to introspect. Defaults to NEON_SOURCE_PROJECT_ID from .env.local if set.",
        valid: sourceReady && sourceVersionKnown,
      });
    } else {
      list.push({
        id: "bundle",
        label: "Bundle",
        heading: "Run the collector and upload the ZIP",
        subtitle:
          "Read-only. Queries pg_catalog and information_schema only, never touches row data.",
        valid: Boolean(uploadFile),
      });
      list.push({
        id: "sourceVersion",
        label: "Source version",
        heading: "Source Postgres version",
        subtitle:
          "The version your source database runs today. Bundle metadata overrides this if present.",
        valid: true,
      });
    }
    list.push({
      id: "target",
      label: "Target version",
      heading: "Target Postgres version",
      subtitle:
        "The version you want to upgrade to. Target Neon project gets picked when you actually run a migration tool, no need to choose one yet.",
      valid: !atLatest && targetVersion > effectiveSourceVersion,
    });
    return list;
  }, [
    atLatest,
    effectiveSourceVersion,
    method,
    sourceReady,
    sourceVersionKnown,
    targetVersion,
    uploadFile,
  ]);

  const activeIndex = Math.min(stepIndex, steps.length - 1);
  const activeStep = steps[activeIndex];
  const isLastStep = activeIndex === steps.length - 1;

  async function runLiveAssessment() {
    if (!sourceReady) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/neon/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "env",
          sourceConnectionString: sourceOverride?.connectionUri,
          // Server re-introspects the source's actual version. We pass the
          // client-side guess as a hint, but server reads pg_settings directly.
          sourceVersion: effectiveSourceVersion,
          targetVersion,
          projectId: sourceOverride?.projectId ?? sourceProject?.id,
          projectName:
            sourceOverride?.projectName ?? cfg?.orgName ?? undefined,
          // Pass any previously-picked target (e.g. from /replication) so
          // schema-diff sections downstream still work, but the assessment
          // itself doesn't require one.
          targetConnectionString: targetOverride?.connectionUri,
          targetProjectId: targetOverride?.projectId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setAssessment(body);
      router.push("/changes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment failed");
    } finally {
      setAnalyzing(false);
    }
  }

  async function runUploadAssessment() {
    if (!uploadFile) return;
    setAnalyzing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("sourceVersion", String(sourceVersion));
      form.append("targetVersion", String(targetVersion));
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setAssessment(body);
      router.push("/changes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className={`${neon.page} flex min-h-full flex-col justify-center`}>
      <div className="mx-auto w-full max-w-[880px]">
        <PageHeader
          title="New assessment"
          subtitle="Detect which Postgres version changes will impact your schema. Choose live introspection or upload an offline bundle."
        />

        {cfg?.orgName && (
          <div className="mb-5 flex items-center justify-between rounded-[4px] border border-primary/25 bg-primary/[0.04] px-4 py-2.5 text-caption">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="text-foreground">
                Connected to <span className="font-medium">{cfg.orgName}</span>
              </span>
            </div>
            {cfg.orgId && (
              <a
                href={`https://console.neon.tech/app/orgs/${cfg.orgId}`}
                target="_blank"
                rel="noreferrer"
                className="text-label text-primary hover:underline"
              >
                Open in Neon Console
              </a>
            )}
          </div>
        )}

        <Card className="gap-0 p-6">
            <Stepper
              steps={steps}
              activeIndex={activeIndex}
              onSelect={(index) => setStepIndex(index)}
            />

            <div className="mt-6 mb-4 flex items-baseline gap-3">
              <span className="tag text-primary">
                Step {String(activeIndex + 1).padStart(2, "0")}
              </span>
              <h2 className={neon.h2}>{activeStep.heading}</h2>
            </div>
            {!(activeStep.id === "target" && atLatest) && (
              <p className={`mb-5 text-ui text-pretty ${neon.muted}`}>
                {activeStep.subtitle}
              </p>
            )}

            {activeStep.id === "method" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectCard
                  selected={method === "live"}
                  onClick={() => setMethod("live")}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <p className="text-body font-medium text-foreground">
                      Live introspection
                    </p>
                  </div>
                  <p className={`mt-2 text-caption leading-[1.5] ${neon.muted}`}>
                    Connects directly to your source Neon project and runs
                    read-only catalog queries.
                  </p>
                </SelectCard>
                <SelectCard
                  selected={method === "upload"}
                  onClick={() => setMethod("upload")}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <p className="text-body font-medium text-foreground">
                      Upload offline bundle
                    </p>
                  </div>
                  <p className={`mt-2 text-caption leading-[1.5] ${neon.muted}`}>
                    Run a read-only bash collector on your own machine, upload
                    the resulting ZIP.
                  </p>
                </SelectCard>
              </div>
            )}

            {activeStep.id === "source" && (
              <>
                <TargetProjectPicker
                  role="source"
                  onChange={setSourceOverrideState}
                  targetPgVersion={effectiveSourceVersion}
                />
                {sourceOverride?.pgVersion && (
                  <p className="mt-2 text-caption text-primary">
                    Detected source runs{" "}
                    <span className="font-mono">
                      PG {sourceOverride.pgVersion}
                    </span>
                    {sourceOverride.pgVersion >= 18 && (
                      <span className="ml-2 text-[#f59e0b]">
                        (already on latest, nothing to upgrade)
                      </span>
                    )}
                  </p>
                )}
                {sourceReady && !sourceVersionKnown && (
                  <p className="mt-2 text-caption text-[#f59e0b]">
                    Could not read this project&apos;s Postgres version from
                    the Neon API. Pick the source project explicitly so the
                    target options are correct.
                  </p>
                )}
                {!sourceReady && (
                  <p className="mt-2 text-caption text-[#f59e0b]">
                    No source configured. Pick one above (requires a Neon API
                    key) or set{" "}
                    <code className="font-mono">
                      NEON_SOURCE_CONNECTION_STRING
                    </code>{" "}
                    in <code className="font-mono">.env.local</code>.
                  </p>
                )}
              </>
            )}

            {activeStep.id === "bundle" && (
              <>
                <Card className="mb-4 gap-0 p-5">
                  <p className="tag mb-2">Step A, on your machine</p>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <Button
                      size="lg"
                      variant="white"
                      nativeButton={false}
                      render={<a href="/api/download-script" />}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download customer_pg_assessment.sh
                    </Button>
                    <p className="text-label text-muted-foreground">
                      Based on{" "}
                      <a
                        href="https://github.com/neondatabase/pg-prechecks"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        neondatabase/pg-prechecks
                      </a>{" "}
                      (MIT)
                    </p>
                  </div>
                  <pre className="overflow-x-auto rounded-[4px] border border-border bg-background p-3 font-mono text-label leading-[1.55] text-foreground">{`chmod +x customer_pg_assessment.sh
./customer_pg_assessment.sh \\
  --host=your-db-host.example.com \\
  --user=postgres \\
  --dbname=your_db

# produces pg_assessment_YYYYMMDD_HHMMSS.zip in the current directory`}</pre>
                </Card>

                <Card className="gap-0 p-5">
                  <p className="tag mb-3">Step B, upload the ZIP here</p>
                  <label
                    className={`flex cursor-pointer flex-col items-center rounded-[4px] border border-dashed px-6 py-10 text-center transition-[background-color,border-color] duration-150 ease-out ${
                      uploadFile
                        ? "border-primary/40 bg-primary/[0.04]"
                        : "border-border bg-background hover:border-primary/40 hover:bg-primary/[0.02]"
                    }`}
                  >
                    {uploadFile ? (
                      <>
                        <FileText className="h-7 w-7 text-primary" />
                        <span className="mt-3 text-ui font-medium text-foreground">
                          {uploadFile.name}
                        </span>
                        <span className="mt-1 font-mono text-label text-muted-foreground">
                          {(uploadFile.size / 1024).toFixed(1)} KB, click to
                          choose a different file
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload className="h-7 w-7 text-muted-foreground" />
                        <span className="mt-3 text-ui font-medium text-foreground">
                          Click to upload pg_assessment_*.zip
                        </span>
                        <span className="mt-1 font-mono text-label text-muted-foreground">
                          or drag and drop
                        </span>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".zip,.tar.gz,.tgz"
                      className="hidden"
                      disabled={analyzing}
                      onChange={(e) =>
                        setUploadFile(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                </Card>
              </>
            )}

            {activeStep.id === "sourceVersion" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {NEON_SUPPORTED_VERSIONS.map((v) => (
                  <SelectCard
                    key={`src-${v}`}
                    selected={sourceVersion === v}
                    onClick={() => {
                      setSourceVersion(v);
                      if (targetVersion <= v) {
                        setTargetVersion(Math.min(18, v + 1) as PgMajorVersion);
                      }
                    }}
                  >
                    <p className="font-mono text-heading font-medium text-foreground">
                      PG {v}
                    </p>
                    <p className={`mt-1 text-label ${neon.muted}`}>
                      {RELEASE_NOTE[v]}
                    </p>
                  </SelectCard>
                ))}
              </div>
            )}

            {activeStep.id === "target" && atLatest && (
              <Notice tone="warning">
                <NoticeIcon>
                  <CircleCheck />
                </NoticeIcon>
                <NoticeBody>
                  <NoticeTitle>Already on the newest version</NoticeTitle>
                  <NoticeDescription>
                    This source runs{" "}
                    <span className="font-mono text-foreground">
                      PG {effectiveSourceVersion}
                    </span>
                    , the newest major Neon supports, so there is no upgrade to
                    assess. Pick a source on an older major to continue.
                  </NoticeDescription>
                  <NoticeActions>
                    <Button
                      size="lg"
                      variant="outline"
                      onClick={() =>
                        setStepIndex(
                          steps.findIndex(
                            (s) => s.id === "source" || s.id === "sourceVersion",
                          ),
                        )
                      }
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Choose a different source
                    </Button>
                  </NoticeActions>
                </NoticeBody>
              </Notice>
            )}

            {activeStep.id === "target" && !atLatest && (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {NEON_SUPPORTED_VERSIONS.map((v) => (
                    <SelectCard
                      key={`tgt-${v}`}
                      selected={targetVersion === v}
                      onClick={() => setTargetVersion(v)}
                      disabled={v <= effectiveSourceVersion}
                    >
                      <p
                        className={`font-mono text-heading font-medium ${
                          v <= effectiveSourceVersion
                            ? "text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        PG {v}
                      </p>
                      <p className={`mt-1 text-label ${neon.muted}`}>
                        {v <= effectiveSourceVersion
                          ? "Not an upgrade"
                          : RELEASE_NOTE[v]}
                      </p>
                    </SelectCard>
                  ))}
                </div>

                <Card className="mt-6 gap-0 p-5">
                  <p className="tag mb-2">Preview tracked changes</p>
                  <p className="text-body text-foreground">
                    <span className="font-mono text-muted-foreground">
                      PG {effectiveSourceVersion}
                    </span>
                    <ArrowRight className="mx-2 inline h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-mono text-primary">
                      PG {targetVersion}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      introduces {previewChanges.length} tracked changes
                    </span>
                  </p>
                </Card>

                <p className="mt-6 text-caption text-muted-foreground">
                  {method === "live"
                    ? "Runs read-only introspection. No schema or row data is modified."
                    : "ZIP is parsed in-app. Source data never leaves your machine until you upload."}
                </p>
              </>
            )}

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
              <Button
                size="lg"
                variant="ghost"
                onClick={() => setStepIndex(activeIndex - 1)}
                disabled={activeIndex === 0 || analyzing}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>

              {isLastStep && atLatest ? null : isLastStep ? (
                <Button
                  size="lg"
                  variant="white"
                  onClick={
                    method === "live" ? runLiveAssessment : runUploadAssessment
                  }
                  disabled={analyzing || !activeStep.valid}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {method === "live"
                        ? "Introspecting…"
                        : "Analyzing bundle…"}
                    </>
                  ) : (
                    <>
                      {method === "live"
                        ? "Run live assessment"
                        : "Analyze uploaded bundle"}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="white"
                  onClick={() => setStepIndex(activeIndex + 1)}
                  disabled={!activeStep.valid}
                >
                  Continue
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
        </Card>

        {error && (
          <p className="mt-4 rounded-[4px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-ui text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Stepper({
  steps,
  activeIndex,
  onSelect,
}: {
  steps: WizardStep[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        const reachable = index <= activeIndex;
        return (
          <li key={step.id} className="flex items-center gap-2">
            {index > 0 && (
              <span className="h-px w-6 bg-border" aria-hidden />
            )}
            <button
              type="button"
              onClick={() => reachable && onSelect(index)}
              disabled={!reachable}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-2 rounded-[4px] px-2 py-1 text-caption transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                reachable ? "hover:bg-muted" : "cursor-default"
              } ${active ? "text-foreground" : "text-muted-foreground"}`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-micro font-medium tnum ${
                  done
                    ? "bg-primary/15 text-primary"
                    : active
                      ? "bg-white text-black"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
