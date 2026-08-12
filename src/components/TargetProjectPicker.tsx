"use client";

import {
  ArrowDown01Icon,
  PlusSignIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  getSourceOverride,
  getTargetOverride,
  setSourceOverride,
  setTargetOverride,
  type TargetOverride,
} from "@/lib/neon-settings";
import { cn } from "@/lib/utils";

interface ProjectRow {
  id: string;
  name: string;
  pg_version: number;
  region_id: string;
  org_id: string;
  org_name: string;
}

interface OrganizationGroup {
  id: string;
  name: string;
  projects: ProjectRow[];
}

interface FailedOrganization {
  id: string;
  name: string;
}

interface ProjectsResponse {
  organizations: OrganizationGroup[];
  failedOrganizations?: FailedOrganization[];
}

interface ServerConfig {
  orgId: string | null;
  orgName: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  authenticated: boolean;
}

function matchesQuery(
  project: ProjectRow,
  organization: OrganizationGroup,
  query: string,
) {
  const terms = query.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return true;
  const organizationName = organization.name.toLowerCase();
  if (terms.every((term) => organizationName.includes(term))) return true;
  const haystack =
    `${project.name} ${project.id} ${project.region_id} ${organization.name}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Searchable source/target selector grouped by every Neon organization the
    current credential can access. The composition follows Neon UI's
    ModelSelect and BranchPicker patterns using registry primitives only. */
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
  const isSource = role === "source";
  const roleNoun = isSource ? "source" : "target";
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationGroup[]>([]);
  const [failedOrganizations, setFailedOrganizations] = useState<
    FailedOrganization[]
  >([]);
  const [override, setOverrideState] = useState<TargetOverride | null>(() =>
    isSource ? getSourceOverride() : getTargetOverride(),
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [createOrg, setCreateOrg] = useState<OrganizationGroup | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const authenticated = Boolean(cfg?.authenticated);
  const writeOverride = (value: TargetOverride | null) =>
    isSource ? setSourceOverride(value) : setTargetOverride(value);
  const envFallbackId = isSource
    ? cfg?.sourceProjectId
    : cfg?.targetProjectId;

  useEffect(() => {
    fetch("/api/neon/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config: ServerConfig | null) => setCfg(config))
      .catch(() => setCfg(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  async function refresh() {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const otherSelection = isSource
        ? getTargetOverride()
        : getSourceOverride();
      const excludeProjectId =
        otherSelection?.projectId ??
        (isSource ? cfg?.targetProjectId : cfg?.sourceProjectId);
      const response = await fetch("/api/neon/projects/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: cfg?.orgId,
          excludeProjectId,
        }),
      });
      const body = (await response.json()) as ProjectsResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `Failed (${response.status})`);
      }
      setOrganizations(body.organizations ?? []);
      setFailedOrganizations(body.failedOrganizations ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "List failed");
    } finally {
      setLoading(false);
    }
  }

  const visibleOrganizations = useMemo(
    () =>
      organizations
        .map((organization) => ({
          ...organization,
          projects: organization.projects.filter((project) =>
            matchesQuery(project, organization, query),
          ),
        }))
        .filter((organization) => organization.projects.length > 0),
    [organizations, query],
  );
  const visibleProjects = visibleOrganizations.flatMap(
    (organization) => organization.projects,
  );
  const activeId = highlightedId ?? visibleProjects[0]?.id ?? null;
  const totalProjects = organizations.reduce(
    (total, organization) => total + organization.projects.length,
    0,
  );

  function selectProject(project: ProjectRow) {
    const next: TargetOverride = {
      projectId: project.id,
      projectName: project.name,
      pgVersion: project.pg_version,
      regionId: project.region_id,
      orgId: project.org_id,
      orgName: project.org_name,
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

  function moveHighlight(direction: 1 | -1) {
    if (visibleProjects.length === 0) return;
    const currentIndex = visibleProjects.findIndex(
      (project) => project.id === activeId,
    );
    const nextIndex =
      currentIndex < 0
        ? 0
        : Math.min(
            Math.max(currentIndex + direction, 0),
            visibleProjects.length - 1,
          );
    setHighlightedId(visibleProjects[nextIndex].id);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Enter" && activeId) {
      const project = visibleProjects.find((item) => item.id === activeId);
      if (project) {
        event.preventDefault();
        selectProject(project);
      }
    }
  }

  function beginCreate(organization: OrganizationGroup) {
    setCreateOrg(organization);
    setNewProjectName(
      `upgrade-target-pg${targetPgVersion}-${new Date().toISOString().slice(0, 10)}`,
    );
    setError(null);
  }

  async function createAndSelect(event: FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!createOrg || !name) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/neon/create-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          pgVersion: targetPgVersion,
          regionId: "aws-us-west-2",
          orgId: createOrg.id,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? `Failed (${response.status})`);
      }
      selectProject({
        id: body.project.id,
        name: body.project.name,
        pg_version: body.project.pg_version,
        region_id: body.project.region_id,
        org_id: createOrg.id,
        org_name: createOrg.name,
      });
      setCreateOrg(null);
      setNewProjectName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={className}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setQuery("");
            setHighlightedId(null);
            setCreateOrg(null);
            if (organizations.length === 0 && authenticated) void refresh();
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              aria-label={`Change ${roleNoun} project`}
              className="h-auto min-w-[280px] justify-start gap-3 px-3 py-2.5 text-left"
              variant="outline"
            />
          }
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted font-mono text-xs text-primary">
            {isSource ? "S" : "T"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm text-foreground">
                {override?.projectName ??
                  envFallbackId ??
                  `Select ${roleNoun} project`}
              </span>
              {override ? (
                <span className="shrink-0 rounded-md border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  PG{override.pgVersion}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
              {override
                ? [override.orgName, override.regionId]
                    .filter(Boolean)
                    .join(" · ")
                : envFallbackId
                  ? "environment default"
                  : `${roleNoun} project`}
            </span>
          </span>
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
            icon={ArrowDown01Icon}
            strokeWidth={2}
          />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="flex max-h-[min(430px,var(--available-height))] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 shadow-2xl"
          side="bottom"
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
              icon={Search01Icon}
              strokeWidth={2}
            />
            <Input
              aria-activedescendant={
                activeId ? `project-option-${activeId}` : undefined
              }
              aria-controls="project-picker-list"
              aria-label={`Search ${roleNoun} projects`}
              className="h-10 rounded-none border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedId(null);
              }}
              onKeyDown={handleListKeyDown}
              placeholder="Search organizations and projects"
              ref={searchRef}
              value={query}
            />
            <Button
              aria-label="Refresh projects"
              disabled={loading}
              onClick={() => void refresh()}
              size="xs"
              type="button"
              variant="ghost"
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
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
              <div
                aria-label={`${roleNoun} projects grouped by organization`}
                className="neon-scroll-fade min-h-0 flex-1 overflow-y-auto p-1"
                id="project-picker-list"
                onKeyDown={handleListKeyDown}
                role="listbox"
              >
                {visibleOrganizations.map((organization) => (
                  <section
                    aria-label={organization.name}
                    className="pb-1"
                    key={organization.id}
                  >
                    <div className="sticky top-0 z-10 flex h-8 items-center gap-2 bg-card/95 px-2 backdrop-blur">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {organization.name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {organization.projects.length}{" "}
                        {organization.projects.length === 1
                          ? "project"
                          : "projects"}
                      </span>
                      {!isSource ? (
                        <Button
                          aria-label={`Create target in ${organization.name}`}
                          onClick={() => beginCreate(organization)}
                          size="xs"
                          type="button"
                          variant="ghost"
                        >
                          <HugeiconsIcon
                            aria-hidden="true"
                            icon={PlusSignIcon}
                            strokeWidth={2}
                          />
                          New target
                        </Button>
                      ) : null}
                    </div>

                    {createOrg?.id === organization.id ? (
                      <form
                        className="mx-1 mb-1 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2"
                        onSubmit={createAndSelect}
                      >
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          Create in {organization.name}
                        </p>
                        <Input
                          aria-label="New project name"
                          className="h-8 font-mono text-xs"
                          onChange={(event) =>
                            setNewProjectName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setCreateOrg(null);
                              setNewProjectName("");
                            }
                          }}
                          value={newProjectName}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            onClick={() => {
                              setCreateOrg(null);
                              setNewProjectName("");
                            }}
                            size="xs"
                            type="button"
                            variant="ghost"
                          >
                            Cancel
                          </Button>
                          <Button
                            disabled={creating || !newProjectName.trim()}
                            size="xs"
                            type="submit"
                          >
                            {creating ? "Creating…" : "Create project"}
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {organization.projects.map((project) => {
                      const selected = override?.projectId === project.id;
                      const highlighted = activeId === project.id;
                      const atLatest = isSource && project.pg_version >= 18;
                      return (
                        <Button
                          aria-selected={selected}
                          className={cn(
                            "h-auto w-full justify-start gap-3 rounded-md px-2 py-2 text-left font-normal",
                            highlighted && "bg-muted text-foreground",
                          )}
                          id={`project-option-${project.id}`}
                          key={project.id}
                          onClick={() => selectProject(project)}
                          onMouseMove={() => setHighlightedId(project.id)}
                          role="option"
                          type="button"
                          variant="ghost"
                        >
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background font-mono text-[10px] text-muted-foreground">
                            PG{project.pg_version}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-foreground">
                              {project.name}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                              {project.id} · {project.region_id}
                              {atLatest ? " · already newest" : ""}
                            </span>
                          </span>
                          {selected ? (
                            <HugeiconsIcon
                              aria-hidden="true"
                              className="size-3.5 shrink-0 text-primary"
                              icon={Tick02Icon}
                              strokeWidth={2}
                            />
                          ) : null}
                        </Button>
                      );
                    })}
                  </section>
                ))}

                {!loading &&
                totalProjects > 0 &&
                visibleOrganizations.length === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No projects match “{query}”.
                  </p>
                ) : null}
                {!loading && organizations.length > 0 && totalProjects === 0 ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No projects are available in these organizations.
                  </p>
                ) : null}
                {!loading && organizations.length === 0 && !error ? (
                  <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No projects loaded. Select Refresh to try again.
                  </p>
                ) : null}
              </div>

              {failedOrganizations.length > 0 ? (
                <p className="border-t border-border/60 px-3 py-2 text-[11px] text-amber-500">
                  Couldn&apos;t load{" "}
                  {failedOrganizations.map((item) => item.name).join(", ")}.
                  Other organizations are still available.
                </p>
              ) : null}
              {error ? (
                <p className="border-t border-border/60 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              ) : null}
              {override ? (
                <div className="border-t border-border/60 p-1">
                  <Button
                    className="w-full justify-start font-mono text-[10px] text-muted-foreground"
                    onClick={clearOverride}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Clear selection
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
