"use client";

/* ──────────────────────────────────────────────────────────────
   Neon connection settings — API key + project ID + optional
   source/target connection strings for live cross-project diffs.
   Local-development fallback until OAuth is wired. Secrets are kept in
   sessionStorage only, so closing the tab clears them. Hosted deployments
   should resolve credentials from the user's server-side OAuth session.
   ────────────────────────────────────────────────────────────── */

const KEY_API = "neon-advisor:api-key";
const KEY_PROJECT = "neon-advisor:project-id";
const KEY_SOURCE_CONN = "neon-advisor:source-conn";
const KEY_TARGET_CONN = "neon-advisor:target-conn";
const KEY_SOURCE_OVERRIDE = "neon-advisor:source-override";
const KEY_TARGET_OVERRIDE = "neon-advisor:target-override";

export interface NeonSettings {
  apiKey: string;
  projectId: string;
  sourceConnectionString: string;
  targetConnectionString: string;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function clearPersistedNeonSecrets() {
  if (typeof window === "undefined") return;
  for (const key of [
    KEY_API,
    KEY_PROJECT,
    KEY_SOURCE_CONN,
    KEY_TARGET_CONN,
    KEY_SOURCE_OVERRIDE,
    KEY_TARGET_OVERRIDE,
  ]) {
    window.localStorage.removeItem(key);
  }
}

export function getNeonSettings(): NeonSettings {
  const storage = browserStorage();
  if (!storage) {
    return {
      apiKey: "",
      projectId: "",
      sourceConnectionString: "",
      targetConnectionString: "",
    };
  }
  clearPersistedNeonSecrets();
  return {
    apiKey: storage.getItem(KEY_API) ?? "",
    projectId: storage.getItem(KEY_PROJECT) ?? "",
    sourceConnectionString: storage.getItem(KEY_SOURCE_CONN) ?? "",
    targetConnectionString: storage.getItem(KEY_TARGET_CONN) ?? "",
  };
}

export function setNeonSettings(next: NeonSettings) {
  const storage = browserStorage();
  if (!storage) return;
  clearPersistedNeonSecrets();
  const pairs: [string, string][] = [
    [KEY_API, next.apiKey],
    [KEY_PROJECT, next.projectId],
    [KEY_SOURCE_CONN, next.sourceConnectionString],
    [KEY_TARGET_CONN, next.targetConnectionString],
  ];
  for (const [k, v] of pairs) {
    if (v) storage.setItem(k, v);
    else storage.removeItem(k);
  }
}

export function hasNeonCredentials(): boolean {
  const s = getNeonSettings();
  return Boolean(s.apiKey && s.projectId);
}

export function hasLiveDiffConnections(): boolean {
  const s = getNeonSettings();
  return Boolean(s.sourceConnectionString && s.targetConnectionString);
}

/* ──────────────────────────────────────────────────────────────
   Target override — pick a specific project as the target without
   editing .env.local. Only non-secret project metadata is retained for the
   current tab. Server routes resolve connection URIs from project ids.
   ────────────────────────────────────────────────────────────── */

export interface TargetOverride {
  projectId: string;
  projectName: string;
  pgVersion: number;
  regionId: string;
  /** Present for multi-organization selections. Optional so project choices
      stored by older app versions remain valid. */
  orgId?: string;
  orgName?: string;
}

function parseProjectOverride(raw: string): TargetOverride | null {
  try {
    const value = JSON.parse(raw) as Partial<TargetOverride>;
    if (
      typeof value.projectId !== "string" ||
      typeof value.projectName !== "string" ||
      typeof value.pgVersion !== "number" ||
      typeof value.regionId !== "string"
    ) {
      return null;
    }
    return {
      projectId: value.projectId,
      projectName: value.projectName,
      pgVersion: value.pgVersion,
      regionId: value.regionId,
      ...(typeof value.orgId === "string" ? { orgId: value.orgId } : {}),
      ...(typeof value.orgName === "string" ? { orgName: value.orgName } : {}),
    };
  } catch {
    return null;
  }
}

export function getTargetOverride(): TargetOverride | null {
  const storage = browserStorage();
  if (!storage) return null;
  clearPersistedNeonSecrets();
  const raw = storage.getItem(KEY_TARGET_OVERRIDE);
  if (!raw) return null;
  return parseProjectOverride(raw);
}

export function setTargetOverride(t: TargetOverride | null) {
  const storage = browserStorage();
  if (!storage) return;
  clearPersistedNeonSecrets();
  if (t) storage.setItem(KEY_TARGET_OVERRIDE, JSON.stringify(t));
  else storage.removeItem(KEY_TARGET_OVERRIDE);
}

/** Same shape as TargetOverride, just for the source project. */
export type SourceOverride = TargetOverride;

export function getSourceOverride(): SourceOverride | null {
  const storage = browserStorage();
  if (!storage) return null;
  clearPersistedNeonSecrets();
  const raw = storage.getItem(KEY_SOURCE_OVERRIDE);
  if (!raw) return null;
  return parseProjectOverride(raw);
}

export function setSourceOverride(t: SourceOverride | null) {
  const storage = browserStorage();
  if (!storage) return;
  clearPersistedNeonSecrets();
  if (t) storage.setItem(KEY_SOURCE_OVERRIDE, JSON.stringify(t));
  else storage.removeItem(KEY_SOURCE_OVERRIDE);
}
