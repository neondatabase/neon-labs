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
  apiKey: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

export async function getProject(apiKey: string, projectId: string) {
  return neonFetch<{ project: NeonProject }>(`/projects/${projectId}`, apiKey);
}

export async function getOrganization(apiKey: string, orgId: string) {
  return neonFetch<{ id: string; name: string }>(
    `/organizations/${orgId}`,
    apiKey,
  );
}

export interface ListProjectsResponse {
  projects: NeonProject[];
  pagination?: { cursor?: string };
}

export async function listProjects(
  apiKey: string,
  opts: { orgId?: string; limit?: number } = {},
) {
  const params = new URLSearchParams();
  if (opts.orgId) params.set("org_id", opts.orgId);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return neonFetch<ListProjectsResponse>(
    `/projects${qs ? `?${qs}` : ""}`,
    apiKey,
  );
}

export async function getConnectionUri(
  apiKey: string,
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
    apiKey,
  );
}

export async function listDatabases(
  apiKey: string,
  projectId: string,
  branchId: string,
) {
  return neonFetch<{
    databases: { name: string; owner_name: string }[];
  }>(`/projects/${projectId}/branches/${branchId}/databases`, apiKey);
}

/* The connection_uri endpoint rejects requests without database_name and
   role_name, so discover the default branch's first database and its owner
   before asking. pooled stays false: logical replication and pg_dump need the
   direct compute, not the pooler. */
export async function resolveConnectionUri(apiKey: string, projectId: string) {
  const { branches } = await listBranches(apiKey, projectId);
  const branch = branches.find((b) => b.default) ?? branches[0];
  if (!branch) throw new Error(`Project ${projectId} has no branches`);
  const { databases } = await listDatabases(apiKey, projectId, branch.id);
  const database = databases[0];
  if (!database) throw new Error(`Branch ${branch.id} has no databases`);
  const { uri } = await getConnectionUri(apiKey, projectId, {
    branchId: branch.id,
    databaseName: database.name,
    roleName: database.owner_name,
    pooled: false,
  });
  return uri;
}

export async function listBranches(apiKey: string, projectId: string) {
  return neonFetch<{ branches: NeonBranch[] }>(
    `/projects/${projectId}/branches`,
    apiKey,
  );
}

export interface CreateBranchParams {
  branchName: string;
  parentBranchId?: string;
}

export async function createBranch(
  apiKey: string,
  projectId: string,
  params: CreateBranchParams,
) {
  return neonFetch<{
    branch: NeonBranch;
    endpoints: NeonEndpoint[];
  }>(`/projects/${projectId}/branches`, apiKey, {
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
  apiKey: string,
  projectId: string,
  branchId: string,
) {
  return neonFetch<{ branch: NeonBranch }>(
    `/projects/${projectId}/branches/${branchId}`,
    apiKey,
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
  apiKey: string,
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
  return neonFetch<CreateProjectResult>("/projects", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** PATCH the project to enable logical replication.
    IMPORTANT: irreversible, wal_level switches to logical permanently
    and all computes restart. Caller should confirm with user first. */
export async function enableLogicalReplication(
  apiKey: string,
  projectId: string,
) {
  return neonFetch<{ project: NeonProject }>(
    `/projects/${projectId}`,
    apiKey,
    {
      method: "PATCH",
      body: JSON.stringify({
        project: { settings: { enable_logical_replication: true } },
      }),
    },
  );
}
