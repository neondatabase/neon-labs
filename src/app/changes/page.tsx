"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useAssessment } from "@/components/AssessmentProvider";
import {
  CopyToggleIcon,
  EmptyState,
  PageHeader,
  ScoreRing,
  StatusBadge,
  neon,
} from "@/components/ui";
import { VersionPath } from "@/components/VersionBadge";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildAgentPrompt } from "@/lib/agent-prompt";
import {
  Notice,
  NoticeActions,
  NoticeBody,
  NoticeDescription,
  NoticeIcon,
  NoticeTitle,
} from "@/components/ui/notice";

type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>;
type FindingsFilter =
  | "attention"
  | "all"
  | "blocker"
  | "warning"
  | "pass";

const SIZE_LIMIT_GB = 1024;
const STATUS_ORDER = { blocker: 0, warning: 1, pass: 2 } as const;

export default function ChangesPage() {
  const { assessment } = useAssessment();
  const [filter, setFilter] = useState<FindingsFilter>("attention");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const copied = copyState === "copied";

  useEffect(() => {
    if (copyState === "idle") return;
    const id = window.setTimeout(() => setCopyState("idle"), 2400);
    return () => window.clearTimeout(id);
  }, [copyState]);

  if (!assessment) {
    return (
      <div className={neon.page}>
        <div className={neon.pageContent}>
          <PageHeader
            title="Version changes"
            subtitle="Breaking changes, deprecations, and behavior shifts between Postgres versions"
          />
          <EmptyState
            title="No version analysis"
            description="Run an upgrade assessment to see which Postgres breaking changes will affect your schema."
            action={
              <Button size="lg" variant="white" nativeButton={false} render={<Link href="/assess" />}>
                New Assessment
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const filtered = assessment.changes.filter((c) => {
    if (filter === "attention") {
      return c.status === "blocker" || c.status === "warning";
    }
    if (filter === "all") return true;
    return c.status === filter;
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const blockers = assessment.changes.filter((c) => c.status === "blocker");
  const warnings = assessment.changes.filter((c) => c.status === "warning");
  const passes = assessment.changes.filter((c) => c.status === "pass");
  const overSizeLimit = assessment.stats.totalSizeGb > SIZE_LIMIT_GB;
  const prompt = buildAgentPrompt(assessment, filtered);
  const findingGroups = [
    {
      id: "version",
      label: `Changes in PG ${assessment.sourceVersion} → PG ${assessment.targetVersion}`,
      description: "Version-specific behavior that can affect this upgrade.",
      changes: filtered.filter(
        (change) =>
          change.category !== "Prerequisite" &&
          change.category !== "Post-migration",
      ),
    },
    {
      id: "prerequisite",
      label: "Migration prerequisites",
      description:
        "Checks that apply to the migration path, independent of Postgres version.",
      changes: filtered.filter((change) => change.category === "Prerequisite"),
    },
    {
      id: "post-migration",
      label: "After migration",
      description: "Work to complete on the target before serving traffic.",
      changes: filtered.filter((change) => change.category === "Post-migration"),
    },
  ].filter((group) => group.changes.length > 0);

  /* A rejected clipboard write used to leave the button silent: no copy, no
     feedback. Denied permission and insecure contexts both land here. */
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className={neon.page}>
      <div className={neon.pageContent}>
        <PageHeader
          title="Version changes"
          subtitle="What changes between Postgres versions, and what it means for your schema"
        />

        {/* Hero score row */}
        <Card className="gap-0 mb-6 p-6">
          <div className="flex flex-wrap items-center gap-8">
            <ScoreRing score={assessment.upgradeScore} />
            <div className="min-w-0 flex-1">
              <p className="tag mb-2">Upgrade verdict</p>
              <p className="text-title font-medium tracking-[-0.5px] text-foreground">
                {assessment.upgradeScore >= 80
                  ? "Clean upgrade path"
                  : assessment.upgradeScore >= 60
                    ? "Upgrade feasible with remediation"
                    : "Significant blockers, plan carefully"}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <VersionPath
                  source={assessment.sourceVersion}
                  target={assessment.targetVersion}
                />
                <span className="text-[#262727]">·</span>
                <Pill icon={AlertOctagon} count={blockers.length} label="Blockers" color="#ef4444" />
                <Pill icon={AlertTriangle} count={warnings.length} label="Warnings" color="#f59e0b" />
                <Pill icon={CheckCircle2} count={passes.length} label="Clear" color="#00e599" />
              </div>
            </div>
          </div>
        </Card>

        {overSizeLimit && (
          <Notice tone="warning" className="mb-6">
            <NoticeIcon>
              <AlertTriangle />
            </NoticeIcon>
            <NoticeBody>
              <NoticeTitle>
                Talk to Neon before migrating this database
              </NoticeTitle>
              <NoticeDescription>
                This database is{" "}
                <span className="font-mono text-foreground">
                  {assessment.stats.totalSizeGb} GB
                </span>
                . Neon has not validated a migration path above 1 TB, and the
                failure modes at that size are slow to recover from. Contact
                Neon to plan the upgrade rather than running one unassisted.
              </NoticeDescription>
              <NoticeActions>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={
                    <a
                      href="https://neon.com/contact-sales"
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Contact Neon
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </NoticeActions>
            </NoticeBody>
          </Notice>
        )}

        {blockers.length === 0 && !overSizeLimit && (
          <Notice tone="info" className="mb-6">
            <NoticeIcon>
              <CheckCircle2 />
            </NoticeIcon>
            <NoticeBody>
              <NoticeTitle>No upgrade blockers found</NoticeTitle>
              <NoticeDescription>
                {warnings.length > 0
                  ? `Review the ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, then choose the migration path that fits your downtime window.`
                  : "This assessment is clear. Choose a migration path to continue the upgrade."}
              </NoticeDescription>
              <NoticeActions>
                <Button
                  size="lg"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href="/migrate" />}
                >
                  Continue to migration assistant
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </NoticeActions>
            </NoticeBody>
          </Notice>
        )}

        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={neon.h2}>Action items</h2>
            <p className={`mt-1 text-caption ${neon.muted}`}>
              Focused on what can break or needs work for PG{" "}
              {assessment.sourceVersion} → PG {assessment.targetVersion}.
            </p>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                {
                  id: "attention",
                  label: "Needs attention",
                  count: blockers.length + warnings.length,
                },
                { id: "blocker", label: "Blockers", count: blockers.length },
                { id: "warning", label: "Warnings", count: warnings.length },
                { id: "pass", label: "Clear", count: passes.length },
                { id: "all", label: "All", count: assessment.changes.length },
              ] as const
            ).map((f) => (
              <Button
                key={f.id}
                type="button"
                size="sm"
                variant={filter === f.id ? "white" : "outline"}
                onClick={() => setFilter(f.id)}
                className="text-label"
              >
                {f.label}
                <span className="ml-1.5 font-mono tnum text-muted-foreground">
                  {f.count}
                </span>
              </Button>
            ))}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPromptOpen(true)}
            disabled={filtered.length === 0}
            aria-label="Review agent prompt before copying"
          >
            <CopyToggleIcon copied={false} className="h-3.5 w-3.5" />
            Copy agent prompt
          </Button>
        </div>

        <Card className="gap-0">
          <Table className="min-w-[720px] text-ui">
            <TableHeader>
              <TableRow className="text-label uppercase tracking-[0.06em] text-muted-foreground hover:bg-transparent">
                <TableHead className="h-auto w-[104px] py-2 pl-5 pr-3 font-medium">
                  Status
                </TableHead>
                <TableHead className="h-auto w-[40%] px-3 py-2 font-medium">
                  Change
                </TableHead>
                <TableHead className="h-auto w-[112px] px-3 py-2 font-medium">
                  Applies to
                </TableHead>
                <TableHead className="h-auto px-3 py-2 font-medium">
                  Detected
                </TableHead>
                <TableHead className="h-auto w-[40px] py-2 pl-1 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="px-5 py-12 text-center text-muted-foreground"
                  >
                    No changes match this filter.
                  </TableCell>
                </TableRow>
              )}
              {findingGroups.map((group) => (
                <Fragment key={group.id}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={5}
                      className="border-y border-border bg-muted/30 px-5 py-2.5"
                    >
                      <p className="text-caption font-medium text-foreground">
                        {group.label}
                      </p>
                      <p className="mt-0.5 text-label text-muted-foreground">
                        {group.description}
                      </p>
                    </TableCell>
                  </TableRow>
                  {group.changes.map((change) => {
                    const open = expanded === change.id;
                    return (
                      <Fragment key={change.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : change.id)}
                        >
                          <TableCell className="py-3 pl-5 pr-3 align-top">
                            <StatusBadge status={change.status} />
                          </TableCell>
                          <TableCell className="whitespace-normal px-3 py-3 align-top">
                            <button
                              type="button"
                              aria-expanded={open}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(open ? null : change.id);
                              }}
                              className="text-left text-foreground outline-none focus-visible:underline"
                            >
                              {change.title}
                            </button>
                          </TableCell>
                          <TableCell className="px-3 py-3 align-top font-mono text-label tnum text-muted-foreground">
                            {change.category === "Prerequisite"
                              ? "Migration"
                              : change.category === "Post-migration"
                                ? "After migration"
                                : `PG ${change.introducedIn}`}
                          </TableCell>
                          <TableCell className="whitespace-normal px-3 py-3 align-top text-caption text-muted-foreground">
                            {change.detectedDetail ?? "—"}
                          </TableCell>
                          <TableCell className="py-3 pl-1 pr-4 align-top text-muted-foreground">
                            <ChevronDown
                              className={`h-3.5 w-3.5 transition-transform duration-150 ease-out ${open ? "rotate-180" : ""}`}
                            />
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="whitespace-normal bg-background/40 px-5 pb-5 pt-1">
                              <div className="max-w-[76ch] space-y-3">
                                <p className={`text-pretty text-ui ${neon.muted}`}>
                                  <InlineCode text={change.description} />
                                </p>
                                {change.remediation && (
                                  <div>
                                    <p className="tag mb-1">Remediation</p>
                                    <p className="text-pretty text-ui text-foreground">
                                      <InlineCode text={change.remediation} />
                                    </p>
                                  </div>
                                )}
                                {change.docsUrl && (
                                  <a
                                    href={change.docsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="relative inline-flex min-h-[24px] w-fit items-center gap-1 rounded-[2px] text-caption text-primary transition-colors duration-150 ease-out before:absolute before:-inset-x-2 before:-inset-y-2 before:content-[''] hover:text-[#7ff5cf] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                                  >
                                    Postgres release notes
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>

        <details className="mt-6 rounded-[4px] border border-border bg-card">
          <summary className="cursor-pointer px-5 py-3 text-ui text-foreground">
            <span className="font-medium">Project details</span>
            <span className="ml-2 font-mono text-label text-muted-foreground">
              PG {assessment.sourceVersion} ·{" "}
              {assessment.stats.totalSizeGb} GB ·{" "}
              {assessment.stats.tables.toLocaleString()} tables
            </span>
          </summary>
          <dl className="grid gap-px border-t border-border bg-border text-ui sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Total size", `${assessment.stats.totalSizeGb} GB`],
              ["Tables", assessment.stats.tables.toLocaleString()],
              ["Databases", assessment.stats.databases],
              ["Extensions", assessment.stats.extensionCount],
              ["PostgreSQL", assessment.metadata.pgVersionFull],
              ["Database", assessment.metadata.database],
              [
                "Assessed",
                new Date(assessment.metadata.assessmentDate).toLocaleString(),
              ],
            ].map(([label, value]) => (
              <div className="bg-card px-4 py-3" key={label}>
                <dt className="tag">{label}</dt>
                <dd className="mt-1 font-mono text-caption text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <Dialog
          open={promptOpen}
          onOpenChange={(open) => {
            setPromptOpen(open);
            if (!open) setCopyState("idle");
          }}
        >
          <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl gap-0 overflow-hidden rounded-[4px] p-0">
            <DialogHeader className="border-b border-border px-5 py-4">
              <DialogTitle>Agent prompt</DialogTitle>
              <DialogDescription>
                Preview the prompt generated from the current findings filter
                before copying it.
              </DialogDescription>
            </DialogHeader>
            <pre
              aria-label="Generated agent prompt"
              className="max-h-[58dvh] overflow-auto whitespace-pre-wrap break-words bg-background/60 px-5 py-4 font-mono text-caption leading-[1.6] text-foreground"
              tabIndex={0}
            >
              {prompt}
            </pre>
            <DialogFooter className="border-t border-border px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPromptOpen(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="white"
                onClick={copyPrompt}
                className={copyState === "failed" ? "text-destructive" : undefined}
              >
                <CopyToggleIcon copied={copied} className="h-3.5 w-3.5" />
                {copyState === "copied"
                  ? "Prompt copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy prompt"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  count,
  label,
  color,
}: {
  icon: IconType;
  count: number;
  label: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-label tnum"
      style={{
        borderColor: `${color}40`,
        backgroundColor: `${color}10`,
        color,
      }}
    >
      <Icon className="h-3 w-3" />
      <span className="font-medium">{count}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

/** The change catalogue writes identifiers and SQL in backticks. Rendering
    them raw put literal backticks on screen. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded-[2px] bg-muted px-1 py-px font-mono text-[0.9em] text-foreground"
          >
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
