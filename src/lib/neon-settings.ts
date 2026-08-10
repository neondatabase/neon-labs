"use client";

/* ──────────────────────────────────────────────────────────────
   Neon connection settings — API key + project ID + optional
   source/target connection strings for live cross-project diffs.
   Stored locally in the browser. Never sent to a 3rd party;
   only passed to this app's own /api/* routes.
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

export function getNeonSettings(): NeonSettings {
  if (typeof window === "undefined") {
    return {
      apiKey: "",
      projectId: "",
      sourceConnectionString: "",
      targetConnectionString: "",
    };
  }
  return {
    apiKey: window.localStorage.getItem(KEY_API) ?? "",
    projectId: window.localStorage.getItem(KEY_PROJECT) ?? "",
    sourceConnectionString: window.localStorage.getItem(KEY_SOURCE_CONN) ?? "",
    targetConnectionString: window.localStorage.getItem(KEY_TARGET_CONN) ?? "",
  };
}

export function setNeonSettings(next: NeonSettings) {
  if (typeof window === "undefined") return;
  const pairs: [string, string][] = [
    [KEY_API, next.apiKey],
    [KEY_PROJECT, next.projectId],
    [KEY_SOURCE_CONN, next.sourceConnectionString],
    [KEY_TARGET_CONN, next.targetConnectionString],
  ];
  for (const [k, v] of pairs) {
    if (v) window.localStorage.setItem(k, v);
    else window.localStorage.removeItem(k);
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
   editing .env.local. Stored client-side; server routes accept the
   override in request bodies and fall back to env when unset.
   ────────────────────────────────────────────────────────────── */

export interface TargetOverride {
  projectId: string;
  projectName: string;
  pgVersion: number;
  regionId: string;
  /** Cached connection URI (fetched server-side, stored client-side after the
      user explicitly picks this target). */
  connectionUri: string;
}

export function getTargetOverride(): TargetOverride | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY_TARGET_OVERRIDE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TargetOverride;
  } catch {
    return null;
  }
}

export function setTargetOverride(t: TargetOverride | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(KEY_TARGET_OVERRIDE, JSON.stringify(t));
  else window.localStorage.removeItem(KEY_TARGET_OVERRIDE);
}

/** Same shape as TargetOverride, just for the source project. */
export type SourceOverride = TargetOverride;

export function getSourceOverride(): SourceOverride | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY_SOURCE_OVERRIDE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SourceOverride;
  } catch {
    return null;
  }
}

export function setSourceOverride(t: SourceOverride | null) {
  if (typeof window === "undefined") return;
  if (t) window.localStorage.setItem(KEY_SOURCE_OVERRIDE, JSON.stringify(t));
  else window.localStorage.removeItem(KEY_SOURCE_OVERRIDE);
}
