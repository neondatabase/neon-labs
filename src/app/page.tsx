import Link from "next/link"
import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ToolCard,
  ToolCardDescription,
  ToolCardFooter,
  ToolCardHeader,
  ToolCardTitle,
  ToolCardWash,
} from "@/components/tool-card"
import { PageHeader, neon } from "@/components/ui"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TOOLS = [
  {
    href: "/assess",
    title: "PG Upgrade Assessment",
    description:
      "See which version changes hit your schema, then pick a path and run the upgrade.",
    meta: "Major version",
    action: "Use tool",
  },
  {
    href: "/migrate",
    title: "Migration Assistant",
    description:
      "Move data between Neon projects with dump/restore or logical replication.",
    meta: "Between projects",
    action: "Use tool",
  },
]

export default function LauncherPage() {
  return (
    <div
      className={cn("flex min-h-full flex-col justify-start pt-4", neon.page)}
    >
      <div className="mx-auto w-full max-w-[760px]">
        <PageHeader
          className="enter-rise mb-6"
          title="Postgres Tools"
          subtitle="Upgrade a project's major version, or move a database between Neon projects."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map(({ href, title, description, meta, action }, i) => (
            <ToolCard
              key={href}
              className="enter-rise"
              style={
                {
                  "--enter-delay": `${(i + 1) * 70}ms`,
                } as React.CSSProperties
              }
            >
              <ToolCardWash />
              <ToolCardHeader>
                <ToolCardTitle className="overflow-visible whitespace-normal">
                  {title}
                </ToolCardTitle>
              </ToolCardHeader>
              <ToolCardDescription>{description}</ToolCardDescription>
              <ToolCardFooter className="justify-between">
                <span className="text-muted-foreground/70 font-mono text-[10px]">
                  {meta}
                </span>
                <Button nativeButton={false} render={<Link href={href} />}>
                  {action}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    data-icon="inline-end"
                    strokeWidth={2}
                  />
                </Button>
              </ToolCardFooter>
            </ToolCard>
          ))}
        </div>
      </div>
    </div>
  )
}
