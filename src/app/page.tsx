import Link from "next/link";
import { ArrowLeftRight, CircleArrowUp } from "lucide-react";
import { NeonMark } from "@/components/NeonLogo";
import { neon } from "@/components/ui";

const TOOLS = [
  {
    href: "/assess",
    icon: CircleArrowUp,
    title: "PG Upgrade Assistant",
    description:
      "Upgrade your Postgres major version on Neon. Assess breaking changes, plan your migration path, and execute the upgrade with guided tooling.",
  },
  {
    href: "/migrate",
    icon: ArrowLeftRight,
    title: "Migration Assistant",
    description:
      "Migrate your database between Neon projects. Compare schemas, transfer data with replication or dump/restore, and cut over with confidence.",
  },
];

export default function LauncherPage() {
  return (
    <div className={`${neon.page} flex min-h-full flex-col justify-center`}>
      <div className="mx-auto w-full max-w-[760px] text-center">
        <NeonMark className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-5 text-display-sm font-medium display-tight text-foreground">
          Neon Labs
        </h1>

        <h2 className={`mt-14 ${neon.h2}`}>Postgres Tools</h2>
        <p className={`mt-1 text-ui text-pretty ${neon.muted}`}>
          Guided workflows for upgrading and migrating your Postgres databases
          on Neon.
        </p>

        <div className="mt-6 grid gap-4 text-left sm:grid-cols-2">
          {TOOLS.map(({ href, icon: Icon, title, description }, i) => (
            <Link
              key={href}
              href={href}
              style={{ "--enter-delay": `${i * 60}ms` } as React.CSSProperties}
              className={`enter-rise group flex flex-col rounded-[4px] border border-border bg-card p-5 transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.99] hover:border-primary/40 hover:bg-[#1a1b1b] ${neon.focusRing}`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <p className="mt-4 text-body-lg font-medium text-foreground">
                {title}
              </p>
              <p className={`mt-2 text-caption leading-[1.6] ${neon.muted}`}>
                {description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
