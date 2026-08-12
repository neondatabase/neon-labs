"use client";

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  projectTicketClassName,
  ProjectTicket,
  ProjectTicketAvatar,
  ProjectTicketBody,
  ProjectTicketMeta,
  ProjectTicketName,
  ProjectTicketVersion,
} from "./project-ticket";
import {
  getSourceOverride,
  getTargetOverride,
  setSourceOverride,
  setTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";

interface ProjectRow {
  id: string;
  name: string;
  pg_version: number;
  region_id: string;
}

interface ServerConfig {
  orgId: string | null;
  orgName: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  authenticated: boolean;
}

/** Compact dropdown that lets the user pick which project in their org should
    act as the upgrade source or target. Stores non-secret project metadata in
    sessionStorage for this tab. Env defaults are honored when the
    user hasn't picked an override.

    `targetPgVersion` controls (a) the PG version used when creating a new
    project via the "+ Create new" action and (b) the label on that action.

    `role` switches between source and target behavior:
      - source: uses NEON_SOURCE_PROJECT_ID as the env default fallback and
        excludes the *target* project (to prevent picking same project on
        both sides). No "create new" button (you typically don't create a
        source on the fly).
      - target (default): existing behavior. */
export function TargetProjectPicker({
  onChange,
  className = "",
  targetPgVersion = 17,
  role = "target",
}: {
  onChange?: (target: TargetOverride | null) => void;
  className?: string;
  targetPgVersion?: number;
  role?: "source" | "target";
}) {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [override, setOverrideState] = useState<TargetOverride | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const isSource = role === "source";
  const authenticated = Boolean(cfg?.authenticated);
  const readOverride = () =>
    isSource ? getSourceOverride() : getTargetOverride();
  const writeOverride = (v: TargetOverride | null) =>
    isSource ? setSourceOverride(v) : setTargetOverride(v);

  useEffect(() => {
    setOverrideState(readOverride());
    fetch("/api/neon/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: ServerConfig | null) => setCfg(c))
      .catch(() => setCfg(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function refresh() {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      // For source picker, exclude target so users can't pick the same project
      // on both sides. For target picker, exclude source (existing behavior).
      const excludeProjectId = isSource
        ? cfg?.targetProjectId
        : cfg?.sourceProjectId;
      const res = await fetch("/api/neon/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: cfg?.orgId,
          excludeProjectId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      setProjects(body.projects as ProjectRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "List failed");
    } finally {
      setLoading(false);
    }
  }

  function selectProject(p: ProjectRow) {
    setError(null);
    const next: TargetOverride = {
      projectId: p.id,
      projectName: p.name,
      pgVersion: p.pg_version,
      regionId: p.region_id,
    };
    writeOverride(next);
    setOverrideState(next);
    onChange?.(next);
    setOpen(false);
  }

  function clearOverride() {
    writeOverride(null);
    setOverrideState(null);
    onChange?.(null);
    setOpen(false);
  }

  async function createAndSelect() {
    if (!authenticated) return;
    const name = window.prompt(
      `New PG${targetPgVersion} project name:`,
      `upgrade-target-pg${targetPgVersion}-${new Date().toISOString().slice(0, 10)}`,
    );
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/neon/create-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pgVersion: targetPgVersion,
          regionId: "aws-us-west-2",
          orgId: cfg?.orgId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Failed (${res.status})`);
      const next: TargetOverride = {
        projectId: body.project.id,
        projectName: body.project.name,
        pgVersion: body.project.pg_version,
        regionId: body.project.region_id,
      };
      writeOverride(next);
      setOverrideState(next);
      onChange?.(next);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  const visibleProjects = query
    ? projects.filter((p) =>
        `${p.name} ${p.id} ${p.region_id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    : projects;

  const envFallbackId = isSource
    ? cfg?.sourceProjectId
    : cfg?.targetProjectId;
  const roleNoun = isSource ? "source" : "target";
  return (
    <div className={className}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next && projects.length === 0 && authenticated) refresh();
          setOpen(next);
        }}
      >
        <PopoverTrigger
          aria-label={`Change ${roleNoun} project`}
          data-slot="project-ticket"
          className={projectTicketClassName({
            className: "min-w-[280px]",
            interactive: true,
            state: override ? "selected" : envFallbackId ? "default" : "empty",
          })}
        >
          <ProjectTicketAvatar>{isSource ? "S" : "T"}</ProjectTicketAvatar>
          <ProjectTicketBody>
            <ProjectTicketName
              version={
                override ? (
                  <ProjectTicketVersion latest={override.pgVersion >= 18}>
                    PG{override.pgVersion}
                  </ProjectTicketVersion>
                ) : undefined
              }
            >
              {override
                ? override.projectName
                : envFallbackId
                  ? envFallbackId
                  : `No ${roleNoun} configured`}
            </ProjectTicketName>
            <ProjectTicketMeta
              items={
                override
                  ? [override.projectId, override.regionId]
                  : [envFallbackId ? "env default" : `${roleNoun} project`]
              }
            />
          </ProjectTicketBody>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>

        <PopoverContent
          side="bottom"
          className="flex max-h-[min(300px,var(--available-height))] w-[380px] flex-col p-2 shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="tag">{isSource ? "Source project" : "Target project"}</span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={refresh}
                aria-label="Refresh"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {!authenticated ? (
            <div className="rounded-[4px] border border-[#f59e0b]/30 bg-[#f59e0b]/[0.08] p-3 text-label text-[#f59e0b]">
              <p>Sign in with Neon to browse and pick projects.</p>
              <a
                href="/api/auth/neon"
                className="mt-2 inline-flex text-foreground underline underline-offset-2"
              >
                Sign in with Neon
              </a>
            </div>
          ) : (
            <>
              {projects.length > 6 && (
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter projects…"
                    aria-label="Filter projects"
                    className="pl-8 text-caption"
                  />
                </div>
              )}

              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                {projects.length === 0 && !loading && (
                  <p className="px-2 py-3 text-center text-label text-muted-foreground">
                    No projects loaded. Click refresh.
                  </p>
                )}
                {projects.length > 0 && visibleProjects.length === 0 && (
                  <p className="px-2 py-3 text-center text-label text-muted-foreground">
                    No projects match “{query}”.
                  </p>
                )}
                {visibleProjects.map((p) => {
                  const selected = override?.projectId === p.id;
                  const atLatest = isSource && p.pg_version >= 18;
                  return (
                    <ProjectTicket
                      key={p.id}
                      interactive
                      state={selected ? "selected" : "default"}
                      className="border-transparent bg-transparent hover:bg-muted"
                      render={
                        <button
                          type="button"
                          onClick={() => selectProject(p)}
                          disabled={loading}
                        />
                      }
                    >
                      <ProjectTicketBody>
                        <ProjectTicketName
                          version={
                            <ProjectTicketVersion latest={atLatest}>
                              PG{p.pg_version}
                            </ProjectTicketVersion>
                          }
                        >
                          {p.name}
                        </ProjectTicketName>
                        <ProjectTicketMeta
                          items={[
                            p.id,
                            p.region_id,
                            atLatest ? "already newest" : null,
                          ]}
                        />
                      </ProjectTicketBody>
                      {selected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </ProjectTicket>
                  );
                })}
              </div>

              <div className="mt-2 border-t border-[#262727] pt-2">
                {!isSource && (
                  <button
                    type="button"
                    onClick={createAndSelect}
                    disabled={creating}
                    className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-caption text-[#00e599] hover:bg-[#00e599]/[0.05]"
                  >
                    {creating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Create new PG{targetPgVersion} project…
                  </button>
                )}
                {override && (
                  <button
                    type="button"
                    onClick={clearOverride}
                    className="mt-1 w-full rounded-[4px] px-2 py-1.5 text-left text-caption text-[#9ca3af] hover:bg-[#1a1b1b] hover:text-foreground"
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {error && (
                <p className="mt-2 rounded-[4px] border border-[#ef4444]/30 bg-[#ef4444]/[0.08] px-2 py-1.5 text-label text-[#ef4444]">
                  {error}
                </p>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
