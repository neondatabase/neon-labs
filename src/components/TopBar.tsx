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
import { neon } from "@/components/ui";
import { cn } from "@/lib/utils";
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

const crumbIdle = cn(
  "rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
  neon.focusRing,
);
const crumbLink = cn("truncate", crumbIdle);

export function TopBar() {
  const pathname = usePathname();
  const atHome = pathname === "/";
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
    <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-background/80 px-8 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-2 md:hidden" />
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 text-ui"
        >
          {atHome ? (
            <span aria-hidden="true" className="rounded-sm p-1 text-foreground">
              <Home className="size-3.5" />
            </span>
          ) : (
            <Link
              aria-label="Home"
              className={cn("p-1 hover:bg-muted", crumbIdle)}
              href="/"
            >
              <Home className="size-3.5" />
            </Link>
          )}
          {atHome ? (
            <>
              <span aria-hidden="true" className="text-border">
                /
              </span>
              <span aria-current="page" className="truncate text-foreground">
                Home
              </span>
            </>
          ) : null}
          {section ? (
            <>
              <span aria-hidden="true" className="text-border">
                /
              </span>
              {title ? (
                <Link href={section.href} className={crumbLink}>
                  {section.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate text-foreground">
                  {section.label}
                </span>
              )}
            </>
          ) : null}
          {title ? (
            <>
              <span aria-hidden="true" className="text-border">
                /
              </span>
              <span aria-current="page" className="truncate text-foreground">
                {title}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="flex items-center gap-1.5">
        {authenticated && !developmentFallback && (
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60",
              neon.focusRing,
            )}
          >
            <LogOut className="size-3.5" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
        {(authenticated || developmentFallback) && (
          <div
            title={user?.name ?? orgName ?? "Connected to Neon"}
            className="relative flex size-7 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-label font-medium text-primary"
          >
            {initials(user?.name ?? orgName ?? "Neon")}
            {user?.image ? (
              // The avatar host is supplied by the user's Neon identity provider.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${user.name} avatar`}
                className="absolute inset-0 size-full object-cover"
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
