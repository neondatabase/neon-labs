"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, LogOut } from "lucide-react";
import { initials } from "@/lib/initials";
import {
  setSourceOverride,
  setTargetOverride,
} from "@/lib/neon-settings";
import { setSetupSkipped } from "@/lib/setup-status";
import { SidebarTrigger } from "./ui/sidebar";

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
  const [user, setUser] = useState<{
    name: string;
    image: string | null;
  } | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [developmentFallback, setDevelopmentFallback] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          cfg: {
            orgName?: string | null;
            authenticated?: boolean;
            developmentFallback?: boolean;
            user?: {
              name?: string | null;
              image?: string | null;
            } | null;
          } | null,
        ) => {
          setOrgName(cfg?.orgName || null);
          setUser(
            cfg?.user?.name
              ? {
                  name: cfg.user.name,
                  image: cfg.user.image || null,
                }
              : null,
          );
          setAuthenticated(Boolean(cfg?.authenticated));
          setDevelopmentFallback(Boolean(cfg?.developmentFallback));
        },
      )
      .catch(() => {
        setOrgName(null);
        setUser(null);
        setAuthenticated(false);
      });
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed");
      setSourceOverride(null);
      setTargetOverride(null);
      setSetupSkipped(false);
      window.location.replace("/");
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[#262727] bg-[#0c0d0d]/80 px-6 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-2 md:hidden" />
        <nav className="flex min-w-0 items-center gap-2 text-ui">
          <Link
            aria-label="Back to Neon Labs"
            className="rounded-[2px] p-1 text-[#9ca3af] transition-colors duration-150 ease-out hover:bg-[#1a1b1b] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]"
            href="/"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>
          {section && (
            <>
              <span className="text-[#262727]">/</span>
              <Link
                href={section.href}
                className="truncate rounded-[2px] text-[#9ca3af] transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c0d0d]"
              >
                {section.label}
              </Link>
            </>
          )}
        {title && (
          <>
              {section ? <span className="text-[#262727]">/</span> : null}
              <span className="truncate text-foreground">{title}</span>
          </>
        )}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        {authenticated && !developmentFallback && (
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption text-[#9ca3af] transition-colors duration-150 ease-out hover:bg-[#1a1b1b] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e599]/50 disabled:cursor-wait disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
        {(authenticated || developmentFallback) && (
          <div
            title={user?.name ?? orgName ?? "Connected to Neon"}
            className="relative ml-1 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[#00e599]/15 text-label font-medium text-[#00e599]"
          >
            {initials(user?.name ?? orgName ?? "Neon")}
            {user?.image ? (
              // The avatar host is supplied by the user's Neon identity provider.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${user.name} avatar`}
                className="absolute inset-0 h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
                referrerPolicy="no-referrer"
                src={user.image}
              />
            ) : null}
          </div>
        )}
      </div>
    </header>
  );
}
