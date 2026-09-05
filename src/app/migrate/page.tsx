"use client";

import Link from "next/link";
import {
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  DatabaseImportIcon,
  DatabaseRestoreIcon,
  DatabaseSyncIcon,
  DiamondMinusIcon,
  DiamondPlusIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'

import { useAssessment } from '@/components/AssessmentProvider'
import { PageHeader, neon } from '@/components/ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsContent,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { UPGRADE_PATH_ROUTES, type UpgradePath } from '@/lib/types'

const PATHS: Record<
  UpgradePath,
  {
    label: string
    icon: IconSvgElement
    sizeRange: string
    downtime: string
    when: string
    consoleInstruction?: string
    pros: string[]
    cons: string[]
    docsUrl: string
  }
> = {
  'import-assistant': {
    label: 'Import Data Assistant',
    icon: DatabaseImportIcon,
    sizeRange: '< 10 GB',
    downtime: 'Minutes',
    when: 'Small databases where you can tolerate a brief read/write pause during the import.',
    consoleInstruction:
      'In Neon Console, click the data import button on the Projects page to continue.',
    pros: [
      'Runs entirely on Neon infrastructure',
      'No CLI / tooling required',
      'Single click after source configured',
    ],
    cons: [
      'Size cap (~10 GB)',
      'Creates an import branch (not root)',
      'Brief write downtime during cutover',
    ],
    docsUrl: 'https://neon.com/docs/import/import-data-assistant',
  },
  'dump-restore': {
    label: 'pg_dump + pg_restore',
    icon: DatabaseRestoreIcon,
    sizeRange: '10 GB – 200 GB',
    downtime: 'Minutes to hours',
    when: 'Medium databases where you have a planned maintenance window. Simple, well-understood, no replication slots to manage.',
    pros: [
      'Simple & well understood',
      'Full pg_dump fidelity with parallel restore',
      'No long-running replication slot',
    ],
    cons: [
      'Downtime scales with database size',
      'pg_dumpall not supported on Neon, dump per-database',
      'Avoid pooled connections, use unpooled',
    ],
    docsUrl: 'https://neon.com/docs/postgresql/postgres-upgrade',
  },
  'logical-replication': {
    label: 'Logical replication',
    icon: DatabaseSyncIcon,
    sizeRange: '> 200 GB',
    downtime: 'Seconds',
    when: "Large databases or workloads that can't afford more than seconds of downtime. Run both projects in parallel and cut over when caught up.",
    pros: [
      'Near-zero downtime cutover',
      'Run old and new versions in parallel',
      'Easy rollback via reverse replication',
    ],
    cons: [
      "Doesn't replicate sequences, large objects, or DDL",
      'Tables must have replica identity (PRIMARY KEY recommended)',
      'Enabling logical replication restarts compute',
    ],
    docsUrl: 'https://neon.com/docs/guides/logical-replication-neon-to-neon',
  },
}

const ORDER: UpgradePath[] = [
  'import-assistant',
  'dump-restore',
  'logical-replication',
]

export default function MigratePage() {
  const { assessment } = useAssessment()
  /* Without an assessment there's no size signal, so nothing is marked
     recommended rather than guessing on the user's behalf. */
  const recommendedPath = assessment?.recommendedPath ?? null
  const defaultPath = recommendedPath ?? ORDER[0]

  return (
    <div className={neon.page}>
      <div className={neon.pageContent}>
        <PageHeader
          title="Migration methods"
          subtitle="Choose a migration method and configure your target project to start migrating."
          className="bg-muted/30 rounded-sm p-6"
          actions={
            !assessment ? (
              <Button
                size="lg"
                variant="outline"
                nativeButton={false}
                render={<Link href="/assess" />}
              >
                Run an assessment first
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  data-icon="inline-end"
                  strokeWidth={2}
                />
              </Button>
            ) : undefined
          }
        />

        <Tabs
          defaultValue={defaultPath}
          className="border-border bg-background flex min-h-88 w-full flex-col items-stretch gap-0 overflow-hidden rounded-lg border"
        >
          <div className="border-border w-full shrink-0 border-b">
            <TabsList
              variant="line"
              className="relative h-auto w-full items-stretch gap-0.5 rounded-none bg-transparent p-1"
            >
              <TabsIndicator className="bg-muted dark:bg-muted rounded-md border-0 shadow-none dark:border-0" />
              {ORDER.map((id, index) => {
                const path = PATHS[id];
                const isRecommended = id === recommendedPath;
                const methodNumber = String(index + 1).padStart(2, "0");
                return (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className="z-10 h-auto min-w-fit flex-1 items-center justify-center gap-2 rounded-md px-2.5 py-2.5 text-center whitespace-normal after:hidden data-active:bg-transparent dark:data-active:bg-transparent"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      icon={path.icon}
                      strokeWidth={2}
                      className="text-muted-foreground in-data-active:text-primary size-5 shrink-0"
                    />
                    <span className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
                      <span className="text-ui font-medium">{path.label}</span>
                      {isRecommended ? (
                        <Badge className="h-4 px-1.5 text-[10px] leading-none">
                          Recommended
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-caption tnum text-muted-foreground in-data-active:text-foreground font-mono">
                      {methodNumber}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {ORDER.map((id) => {
            const path = PATHS[id];
            const isConsoleHandoff = id === "import-assistant";
            return (
              <TabsContent
                key={id}
                value={id}
                className="flex min-w-0 flex-1 flex-col self-stretch"
              >
                <div className="flex flex-1 flex-col gap-6 px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
                    <div className="flex min-w-0 flex-1 flex-col items-baseline gap-3">
                      <h2 className={`${neon.h2} shrink-0`}>{path.label}</h2>
                      <div className="flex max-w-xl min-w-0 flex-col gap-1.5">
                        <p className="text-ui text-muted-foreground text-pretty">
                          {path.when}
                        </p>
                        {path.consoleInstruction ? (
                          <p className="text-ui text-muted-foreground text-pretty">
                            {path.consoleInstruction}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <dl className="flex shrink-0 gap-8">
                      <PathMetric label="Size" value={path.sizeRange} />
                      <PathMetric label="Downtime" value={path.downtime} />
                    </dl>
                  </div>

                  <div className="grid gap-2 rounded-sm sm:grid-cols-2">
                    <div className="bg-secondary flex flex-col gap-2 rounded-xs p-3.5">
                      <p className="font-medium uppercase">Pros</p>
                      <PathList items={path.pros} tone="pro" />
                    </div>
                    <div className="bg-secondary flex flex-col gap-2 rounded-xs p-3.5">
                      <p className="font-medium uppercase">Cons</p>
                      <PathList items={path.cons} tone="con" />
                    </div>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 px-6 py-4">
                  <Button
                    variant="ghost"
                    nativeButton={false}
                    render={
                      <a href={path.docsUrl} target="_blank" rel="noreferrer" />
                    }
                  >
                    Neon docs
                    <HugeiconsIcon
                      icon={ArrowUpRight01Icon}
                      data-icon="inline-end"
                      strokeWidth={2}
                    />
                  </Button>
                  <Button
                    nativeButton={false}
                    render={
                      isConsoleHandoff ? (
                        <a
                          href={UPGRADE_PATH_ROUTES[id]}
                          target="_blank"
                          rel="noreferrer"
                        />
                      ) : (
                        <Link href={UPGRADE_PATH_ROUTES[id]} />
                      )
                    }
                  >
                    {isConsoleHandoff ? "Open Neon Console" : "Start migration"}
                    <HugeiconsIcon
                      icon={
                        isConsoleHandoff ? ArrowUpRight01Icon : ArrowRight02Icon
                      }
                      data-icon="inline-end"
                      strokeWidth={2}
                    />
                  </Button>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </div>
  );
}

function PathMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-right">
      <dt className="tag">{label}</dt>
      <dd className="font-mono text-caption text-foreground">{value}</dd>
    </div>
  )
}

function PathList({ items, tone }: { items: string[]; tone: 'pro' | 'con' }) {
  const icon = tone === 'pro' ? DiamondPlusIcon : DiamondMinusIcon
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-caption">
          <HugeiconsIcon
            aria-hidden
            icon={icon}
            strokeWidth={2}
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70"
          />
          <span className="text-sm text-muted-foreground">{item}</span>
        </li>
      ))}
    </ul>
  )
}
