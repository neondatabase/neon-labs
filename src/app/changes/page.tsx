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
  Database,
  ExternalLink,
  HardDrive,
  Layers,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
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

const SIZE_LIMIT_GB = 1024;

export default function ChangesPage() {
  const { assessment } = useAssessment();
  const [filter, setFilter] = useState<"all" | "blocker" | "warning" | "pass">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
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
    if (filter === "all") return true;
    return c.status === filter;
  });

  const blockers = assessment.changes.filter((c) => c.status === "blocker");
  const warnings = assessment.changes.filter((c) => c.status === "warning");
  const passes = assessment.changes.filter((c) => c.status === "pass");
  const overSizeLimit = assessment.stats.totalSizeGb > SIZE_LIMIT_GB;

  /* A rejected clipboard write used to leave the button silent: no copy, no
     feedback. Denied permission and insecure contexts both land here. */
  async function copyPrompt() {
    const prompt = buildAgentPrompt(assessment!, filtered);
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

        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Total size",
              value: `${assessment.stats.totalSizeGb} GB`,
              icon: HardDrive,
            },
            {
              label: "Tables",
              value: assessment.stats.tables.toLocaleString(),
              icon: Layers,
            },
            {
              label: "Databases",
              value: assessment.stats.databases,
              icon: Database,
            },
            {
              label: "Extensions",
              value: assessment.stats.extensionCount,
              icon: Puzzle,
            },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="gap-0 p-5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-primary" />
                <span className="tag">{label}</span>
              </div>
              <p className="mt-2 text-display-sm font-medium tracking-[-0.64px] tnum text-foreground">
                {value}
              </p>
            </Card>
          ))}
        </div>

        <Card className="mb-6 gap-0">
          <CardHeader className="border-b border-border px-5 py-4">
            <h2 className={neon.h2}>Source database</h2>
          </CardHeader>
          <dl className="divide-y divide-border text-ui">
            {[
              ["PostgreSQL", assessment.metadata.pgVersionFull, true],
              ["Database", assessment.metadata.database, true],
              [
                "Assessed",
                new Date(assessment.metadata.assessmentDate).toLocaleString(),
                false,
              ],
            ].map(([k, v, mono]) => (
              <div
                key={k as string}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <dt className={neon.muted}>{k}</dt>
                <dd
                  className={
                    mono
                      ? "text-right font-mono text-caption text-primary"
                      : "text-foreground"
                  }
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "all", label: "All", count: assessment.changes.length },
                { id: "blocker", label: "Blockers", count: blockers.length },
                { id: "warning", label: "Warnings", count: warnings.length },
                { id: "pass", label: "Clear", count: passes.length },
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
            onClick={copyPrompt}
            disabled={filtered.length === 0}
            aria-label={
              copyState === "copied"
                ? "Agent prompt copied"
                : copyState === "failed"
                  ? "Could not copy the agent prompt"
                  : "Copy agent prompt to clipboard"
            }
            className={copyState === "failed" ? "text-destructive" : undefined}
          >
            <CopyToggleIcon copied={copied} className="h-3.5 w-3.5" />
            <span className="grid">
              <span
                aria-hidden
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
              >
                Copy agent prompt
              </span>
              <span className="col-start-1 row-start-1 whitespace-nowrap text-center">
                {copyState === "copied"
                  ? "Prompt copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy agent prompt"}
              </span>
            </span>
          </Button>
        </div>

        <Card className="gap-0">
          <Table className="text-ui">
            <TableHeader>
              <TableRow className="text-label uppercase tracking-[0.06em] text-muted-foreground hover:bg-transparent">
                <TableHead className="h-auto w-[104px] py-2 pl-5 pr-3 font-medium">
                  Status
                </TableHead>
                <TableHead className="h-auto w-[40%] px-3 py-2 font-medium">
                  Change
                </TableHead>
                <TableHead className="h-auto w-[76px] px-3 py-2 font-medium">
                  Since
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
              {filtered.map((change) => {
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
                        PG {change.introducedIn}
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
            </TableBody>
          </Table>
        </Card>
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
