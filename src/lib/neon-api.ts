/* ──────────────────────────────────────────────────────────────
   Thin Neon API client (server-side).
   Docs: https://api-docs.neon.tech
   ────────────────────────────────────────────────────────────── */

const NEON_API_BASE = "https://console.neon.tech/api/v2";

export interface NeonProject {
  id: string;
  name: string;
  pg_version: number;
  region_id: string;
  org_id?: string;
}

export interface NeonBranch {
  id: string;
  name: string;
  project_id: string;
  parent_id?: string;
  default: boolean;
  pg_version?: number;
  created_at: string;
}

export interface NeonEndpoint {
  id: string;
  host: string;
  branch_id: string;
  type: "read_write" | "read_only";
}

async function neonFetch<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Neon API ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function getProject(accessToken: string, projectId: string) {
  return neonFetch<{ project: NeonProject }>(
    `/projects/${projectId}`,
    accessToken,
  );
}

export async function getOrganization(accessToken: string, orgId: string) {
  return neonFetch<{ id: string; name: string }>(
    `/organizations/${orgId}`,
    accessToken,
  );
}

export interface NeonOrganization {
  id: string;
  name: string;
}

export async function listOrganizations(accessToken: string) {
  return neonFetch<{ organizations: NeonOrganization[] }>(
    "/users/me/organizations",
    accessToken,
  );
}

export interface ListProjectsResponse {
  projects: NeonProject[];
  pagination?: { cursor?: string };
}

export async function listProjects(
  accessToken: string,
  opts: { orgId?: string; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (opts.orgId) params.set("org_id", opts.orgId);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return neonFetch<ListProjectsResponse>(
    `/projects${qs ? `?${qs}` : ""}`,
    accessToken,
  );
}

/* Neon rejects an org-less GET /projects with "org_id is required", so when
   the caller has no org configured, fan out over the orgs the user can see.
   One unreachable org shouldn't blank the whole picker, so failures are
   dropped rather than propagated. */
export async function listProjectsAcrossOrgs(
  accessToken: string,
  opts: { orgId?: string; limit?: number } = {},
): Promise<ListProjectsResponse> {
  if (opts.orgId) return listProjects(accessToken, opts);

  const { organizations } = await listOrganizations(accessToken);
  const results = await Promise.allSettled(
    organizations.map((org) =>
      listProjects(accessToken, { orgId: org.id, limit: opts.limit }),
    ),
  );
  const projects = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value.projects : [],
  );
  return { projects };
}

export async function getConnectionUri(
  accessToken: string,
  projectId: string,
  opts: {
    branchId?: string;
    databaseName?: string;
    roleName?: string;
    pooled?: boolean;
  } = {},
) {
  const params = new URLSearchParams();
  if (opts.branchId) params.set("branch_id", opts.branchId);
  if (opts.databaseName) params.set("database_name", opts.databaseName);
  if (opts.roleName) params.set("role_name", opts.roleName);
  if (opts.pooled !== undefined) params.set("pooled", String(opts.pooled));
  return neonFetch<{ uri: string }>(
    `/projects/${projectId}/connection_uri${params.toString() ? `?${params.toString()}` : ""}`,
    accessToken,
  );
}

export async function listDatabases(
  accessToken: string,
  projectId: string,
  branchId: string,
) {
  return neonFetch<{
    databases: { name: string; owner_name: string }[];
  }>(`/projects/${projectId}/branches/${branchId}/databases`, accessToken);
}

/* The connection_uri endpoint rejects requests without database_name and
   role_name, so discover the default branch's first database and its owner
   before asking. pooled stays false: logical replication and pg_dump need the
   direct compute, not the pooler. */
export async function resolveConnectionUri(
  accessToken: string,
  projectId: string,
) {
  const { branches } = await listBranches(accessToken, projectId);
  const branch = branches.find((b) => b.default) ?? branches[0];
  if (!branch) throw new Error(`Project ${projectId} has no branches`);
  const { databases } = await listDatabases(
    accessToken,
    projectId,
    branch.id,
  );
  const database = databases[0];
  if (!database) throw new Error(`Branch ${branch.id} has no databases`);
  const { uri } = await getConnectionUri(accessToken, projectId, {
    branchId: branch.id,
    databaseName: database.name,
    roleName: database.owner_name,
    pooled: false,
  });
  return uri;
}

export async function listBranches(accessToken: string, projectId: string) {
  return neonFetch<{ branches: NeonBranch[] }>(
    `/projects/${projectId}/branches`,
    accessToken,
  );
}

export interface CreateBranchParams {
  branchName: string;
  parentBranchId?: string;
}

export async function createBranch(
  accessToken: string,
  projectId: string,
  params: CreateBranchParams,
) {
  return neonFetch<{
    branch: NeonBranch;
    endpoints: NeonEndpoint[];
  }>(`/projects/${projectId}/branches`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      branch: {
        name: params.branchName,
        parent_id: params.parentBranchId,
      },
      endpoints: [{ type: "read_write" }],
    }),
  });
}

export async function deleteBranch(
  accessToken: string,
  projectId: string,
  branchId: string,
) {
  return neonFetch<{ branch: NeonBranch }>(
    `/projects/${projectId}/branches/${branchId}`,
    accessToken,
    { method: "DELETE" },
  );
}

export interface CreateProjectParams {
  name: string;
  /** PG major version, e.g. 17 */
  pgVersion?: number;
  /** Region id, e.g. "aws-us-west-2" */
  regionId?: string;
  /** Org id to create the project in. If omitted, goes to your default. */
  orgId?: string;
}

export interface CreateProjectResult {
  project: NeonProject;
  branch: NeonBranch;
  endpoints: NeonEndpoint[];
  databases: { id: number; name: string; owner_name: string }[];
  roles: { name: string; password?: string }[];
  connection_uris: { connection_uri: string; connection_parameters: unknown }[];
}

export async function createProject(
  accessToken: string,
  params: CreateProjectParams,
): Promise<CreateProjectResult> {
  const body: Record<string, unknown> = {
    project: {
      name: params.name,
      ...(params.pgVersion ? { pg_version: params.pgVersion } : {}),
      ...(params.regionId ? { region_id: params.regionId } : {}),
      ...(params.orgId ? { org_id: params.orgId } : {}),
    },
  };
  return neonFetch<CreateProjectResult>("/projects", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** PATCH the project to enable logical replication.
    IMPORTANT: irreversible, wal_level switches to logical permanently
    and all computes restart. Caller should confirm with user first. */
export async function enableLogicalReplication(
  accessToken: string,
  projectId: string,
) {
  return neonFetch<{ project: NeonProject }>(
    `/projects/${projectId}`,
    accessToken,
    {
      method: "PATCH",
      body: JSON.stringify({
        project: { settings: { enable_logical_replication: true } },
      }),
    },
  );
}
