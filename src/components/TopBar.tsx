"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { initials } from "@/lib/initials";

const TITLES: Record<string, string> = {
  "/assess": "New assessment",
  "/changes": "Version changes",
  "/migrate": "Choose a method",
  "/migrate/replication": "Logical replication",
  "/migrate/dump-restore": "pg_dump → pg_restore",
  "/migrate/import-assistant": "Import Data Assistant",
  "/extensions": "Extensions",
};

/* Second breadcrumb crumb: which of the two tools the page belongs to. */
const SECTIONS: { match: (p: string) => boolean; label: string; href: string }[] =
  [
    {
      match: (p) => p.startsWith("/migrate"),
      label: "Migration Assistant",
      href: "/migrate",
    },
    {
      match: (p) => p.startsWith("/assess") || p.startsWith("/changes"),
      label: "PG Upgrade Assessment",
      href: "/assess",
    },
  ];

export function TopBar() {
  const pathname = usePathname();
  const section = SECTIONS.find((s) => s.match(pathname)) ?? null;
  /* At a section root the section crumb already names the page. */
  const title = pathname === section?.href ? null : (TITLES[pathname] ?? null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { orgName?: string | null } | null) =>
        setOrgName(cfg?.orgName || null),
      )
      .catch(() => setOrgName(null));
  }, []);

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[#262727] bg-[#0c0d0d]/80 px-6 backdrop-blur">
      <nav className="flex items-center gap-2 text-ui">
        <Link href="/" className="rounded-[2px] text-[#9ca3af] transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]">
          Neon Labs
        </Link>
        {section && (
          <>
            <span className="text-[#262727]">/</span>
            <Link
              href={section.href}
              className="rounded-[2px] text-[#9ca3af] transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]"
            >
              {section.label}
            </Link>
          </>
        )}
        {title && (
          <>
            <span className="text-[#262727]">/</span>
            <span className="text-foreground">{title}</span>
          </>
        )}
      </nav>

      <div className="flex items-center gap-2">
        <div
          title={orgName ?? "Not connected"}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#00e599]/15 text-label font-medium text-[#00e599]"
        >
          {initials(orgName ?? "Neon Labs")}
        </div>
      </div>
    </header>
  );
}
