"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, LogIn, LogOut } from "lucide-react"
import { initials } from "@/lib/initials"
import { setSourceOverride, setTargetOverride } from "@/lib/neon-settings"
import { setSetupSkipped } from "@/lib/setup-status"
import { neon } from "@/components/ui"
import { cn } from "@/lib/utils"
import { Button } from "./ui/button"
import { SidebarTrigger } from "./ui/sidebar"

const TITLES: Record<string, string> = {
  "/assess": "New assessment",
  "/changes": "Version changes",
  "/migrate": "Choose a method",
  "/migrate/replication": "Logical replication",
  "/migrate/dump-restore": "pg_dump → pg_restore",
  "/migrate/import-assistant": "Import Data Assistant",
  "/extensions": "Extensions",
}

/* Second breadcrumb crumb: which of the two tools the page belongs to. */
const SECTIONS: {
  match: (p: string) => boolean
  label: string
  href: string
}[] = [
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
]

const crumbIdle = cn(
  "rounded-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
  neon.focusRing,
)
const crumbLink = cn("truncate", crumbIdle)

export function TopBar() {
  const pathname = usePathname()
  const atHome = pathname === "/"
  const section = SECTIONS.find((s) => s.match(pathname)) ?? null
  /* At a section root the section crumb already names the page. */
  const title = pathname === section?.href ? null : (TITLES[pathname] ?? null)
  const [orgName, setOrgName] = useState<string | null>(null)
  const [user, setUser] = useState<{
    name: string
    image: string | null
  } | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [developmentFallback, setDevelopmentFallback] = useState(false)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signedIn = authenticated || developmentFallback
  const signInHref = `/api/auth/neon?returnTo=${encodeURIComponent(pathname)}`

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    fetch("/api/neon/config", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          cfg: {
            orgName?: string | null
            authenticated?: boolean
            developmentFallback?: boolean
            user?: {
              name?: string | null
              image?: string | null
            } | null
          } | null,
        ) => {
          if (cancelled) return
          setOrgName(cfg?.orgName || null)
          setUser(
            cfg?.user?.name
              ? {
                  name: cfg.user.name,
                  image: cfg.user.image || null,
                }
              : null,
          )
          setAuthenticated(Boolean(cfg?.authenticated))
          setDevelopmentFallback(Boolean(cfg?.developmentFallback))
        },
      )
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
        setOrgName(null)
        setUser(null)
        setAuthenticated(false)
        setDevelopmentFallback(false)
      })
      .finally(() => {
        if (!cancelled) setSessionLoaded(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  async function signOut() {
    setSigningOut(true)
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error("Sign out failed")
      setSourceOverride(null)
      setTargetOverride(null)
      setSetupSkipped(false)
      window.location.replace("/")
    } catch {
      setSigningOut(false)
    }
  }

  return (
    <header className="border-border bg-background/80 sticky top-0 z-10 flex h-[52px] items-center justify-between border-b px-8 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-2 md:hidden" />
        <nav
          aria-label="Breadcrumb"
          className="text-ui flex min-w-0 items-center gap-2"
        >
          {atHome ? (
            <span aria-hidden="true" className="text-foreground rounded-sm p-1">
              <Home className="size-3.5" />
            </span>
          ) : (
            <Link
              aria-label="Home"
              className={cn("hover:bg-muted p-1", crumbIdle)}
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
              <span aria-current="page" className="text-foreground truncate">
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
                <span aria-current="page" className="text-foreground truncate">
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
              <span aria-current="page" className="text-foreground truncate">
                {title}
              </span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="flex items-center gap-1.5">
        {sessionLoaded && !signedIn ? (
          <Button
            variant="default"
            className="rounded-xl"
            nativeButton={false}
            render={<a href={signInHref} />}
          >
            <LogIn data-icon="inline-start" />
            Sign in to use Postgres tools.
          </Button>
        ) : null}
        {authenticated && !developmentFallback && (
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className={cn(
              "text-caption text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors duration-150 ease-out disabled:cursor-wait disabled:opacity-60",
              neon.focusRing,
            )}
          >
            <LogOut className="size-3.5" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        )}
        {signedIn && (
          <div
            title={user?.name ?? orgName ?? "Connected to Neon"}
            className="bg-primary/15 text-label text-primary relative flex size-7 items-center justify-center overflow-hidden rounded-full font-medium"
          >
            {initials(user?.name ?? orgName ?? "Neon")}
            {user?.image ? (
              // The avatar host is supplied by the user's Neon identity provider.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${user.name} avatar`}
                className="absolute inset-0 size-full object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none"
                }}
                referrerPolicy="no-referrer"
                src={user.image}
              />
            ) : null}
          </div>
        )}
      </div>
    </header>
  )
}
