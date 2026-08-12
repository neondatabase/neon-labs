"use client";

/* Non-secret source and target project selections for the current tab.
   OAuth credentials live only in an encrypted HttpOnly server session. */

const KEY_API = "neon-advisor:api-key";
const KEY_PROJECT = "neon-advisor:project-id";
const KEY_SOURCE_CONN = "neon-advisor:source-conn";
const KEY_TARGET_CONN = "neon-advisor:target-conn";
const KEY_SOURCE_OVERRIDE = "neon-advisor:source-override";
const KEY_TARGET_OVERRIDE = "neon-advisor:target-override";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

export function clearPersistedNeonSecrets() {
  if (typeof window === "undefined") return;
  for (const key of [KEY_API, KEY_PROJECT, KEY_SOURCE_CONN, KEY_TARGET_CONN]) {
    window.sessionStorage.removeItem(key);
  }
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

/* ──────────────────────────────────────────────────────────────
   Target override — only non-secret project metadata is retained for the
   current tab. Server routes resolve connection URIs from project ids.
   ────────────────────────────────────────────────────────────── */

export interface TargetOverride {
  projectId: string;
  projectName: string;
  pgVersion: number;
  regionId: string;
}

export function getTargetOverride(): TargetOverride | null {
  const storage = browserStorage();
  if (!storage) return null;
  clearPersistedNeonSecrets();
  const raw = storage.getItem(KEY_TARGET_OVERRIDE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TargetOverride;
  } catch {
    return null;
  }
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
  try {
    return JSON.parse(raw) as SourceOverride;
  } catch {
    return null;
  }
}

export function setSourceOverride(t: SourceOverride | null) {
  const storage = browserStorage();
  if (!storage) return;
  clearPersistedNeonSecrets();
  if (t) storage.setItem(KEY_SOURCE_OVERRIDE, JSON.stringify(t));
  else storage.removeItem(KEY_SOURCE_OVERRIDE);
}
