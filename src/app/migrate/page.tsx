"use client";

import Link from "next/link";
import { ArrowRight, Check, ExternalLink } from "lucide-react";

import { useAssessment } from "@/components/AssessmentProvider";
import { PageHeader, neon } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { UPGRADE_PATH_ROUTES, type UpgradePath } from "@/lib/types";

const PATHS: Record<
  UpgradePath,
  {
    label: string;
    sizeRange: string;
    downtime: string;
    when: string;
    consoleInstruction?: string;
    pros: string[];
    cons: string[];
    docsUrl: string;
  }
> = {
  "import-assistant": {
    label: "Import Data Assistant",
    sizeRange: "< 10 GB",
    downtime: "Minutes",
    when:
      "Small databases where you can tolerate a brief read/write pause during the import.",
    consoleInstruction:
      "In Neon Console, click the data import button on the Projects page to continue.",
    pros: [
      "Runs entirely on Neon infrastructure",
      "No CLI / tooling required",
      "Single click after source configured",
    ],
    cons: [
      "Size cap (~10 GB)",
      "Creates an import branch (not root)",
      "Brief write downtime during cutover",
    ],
    docsUrl: "https://neon.com/docs/import/import-data-assistant",
  },
  "dump-restore": {
    label: "pg_dump + pg_restore",
    sizeRange: "10 GB – 200 GB",
    downtime: "Minutes to hours",
    when:
      "Medium databases where you have a planned maintenance window. Simple, well-understood, no replication slots to manage.",
    pros: [
      "Simple & well understood",
      "Full pg_dump fidelity with parallel restore",
      "No long-running replication slot",
    ],
    cons: [
      "Downtime scales with database size",
      "pg_dumpall not supported on Neon, dump per-database",
      "Avoid pooled connections, use unpooled",
    ],
    docsUrl: "https://neon.com/docs/postgresql/postgres-upgrade",
  },
  "logical-replication": {
    label: "Logical replication",
    sizeRange: "> 200 GB or zero-downtime",
    downtime: "Seconds",
    when:
      "Large databases or workloads that can't afford more than seconds of downtime. Run both projects in parallel and cut over when caught up.",
    pros: [
      "Near-zero downtime cutover",
      "Run old and new versions in parallel",
      "Easy rollback via reverse replication",
    ],
    cons: [
      "Doesn't replicate sequences, large objects, or DDL",
      "Tables must have replica identity (PRIMARY KEY recommended)",
      "Enabling logical replication restarts compute",
    ],
    docsUrl: "https://neon.com/docs/guides/logical-replication-neon-to-neon",
  },
};

const ORDER: UpgradePath[] = [
  "import-assistant",
  "dump-restore",
  "logical-replication",
];

export default function MigratePage() {
  const { assessment } = useAssessment();
  /* Without an assessment there's no size signal, so nothing is marked
     recommended rather than guessing on the user's behalf. */
  const recommendedPath = assessment?.recommendedPath ?? null;

  return (
    <div className={neon.page}>
      <div className={neon.pageContent}>
        <PageHeader
          title="Migrate"
          subtitle="Choose a migration method and configure your target project."
          actions={
            !assessment ? (
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/assess" />}
              >
                Run an assessment first
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            ) : undefined
          }
        />

        <h2 className={`${neon.h2} mb-3`}>Migration method</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {ORDER.map((id, i) => {
            const p = PATHS[id];
            const isRecommended = id === recommendedPath;
            const isConsoleHandoff = id === "import-assistant";
            return (
              <Link
                key={id}
                href={UPGRADE_PATH_ROUTES[id]}
                rel={isConsoleHandoff ? "noreferrer" : undefined}
                style={{ "--enter-delay": `${i * 60}ms` } as React.CSSProperties}
                target={isConsoleHandoff ? "_blank" : undefined}
                className={`enter-rise group flex flex-col rounded-[4px] border p-5 transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.99] ${neon.focusRing} ${
                  isRecommended
                    ? "border-primary/40 bg-primary/[0.04] hover:border-primary/60"
                    : "border-border bg-card hover:border-primary/40 hover:bg-[#1a1b1b]"
                }`}
              >
                {isRecommended && (
                  <p className="tag mb-2 text-primary">Recommended</p>
                )}
                <p className="text-body font-medium text-foreground">
                  {p.label}
                </p>
                {isConsoleHandoff && (
                  <p className={`mt-1 text-label ${neon.muted}`}>
                    Runs entirely in Neon Console.
                  </p>
                )}
                <div className="mt-3 flex gap-3 text-label">
                  <span className="font-mono text-foreground">
                    {p.sizeRange}
                  </span>
                  <span className="text-border">·</span>
                  <span className={neon.muted}>Downtime: {p.downtime}</span>
                </div>

                <div className="mt-4">
                  <p className="tag mb-2">Pros</p>
                  <ul className="space-y-1.5 text-caption text-foreground">
                    {p.pros.map((x) => (
                      <li key={x} className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4">
                  <p className="tag mb-2">Cons</p>
                  <ul className={`space-y-1.5 text-caption ${neon.muted}`}>
                    {p.cons.map((x) => (
                      <li key={x} className="flex items-start gap-1.5">
                        <span className="mt-0.5 h-3 w-3 shrink-0">·</span>
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>

                <p className={`mt-4 text-caption leading-[1.6] ${neon.muted}`}>
                  {p.when}
                </p>
                {p.consoleInstruction && (
                  <p className={`mt-2 text-caption leading-[1.6] ${neon.muted}`}>
                    {p.consoleInstruction}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <span className="inline-flex items-center gap-1 text-caption font-medium text-primary">
                    {isConsoleHandoff ? "Open Neon Console" : "Start"}
                    {isConsoleHandoff ? (
                      <ExternalLink className="h-3 w-3" />
                    ) : (
                      <ArrowRight className="h-3 w-3" />
                    )}
                  </span>
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(p.docsUrl, "_blank", "noreferrer");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(p.docsUrl, "_blank", "noreferrer");
                      }
                    }}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-[2px] text-caption transition-colors duration-150 ease-out hover:text-primary hover:underline ${neon.muted} ${neon.focusRing}`}
                  >
                    Neon docs
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
