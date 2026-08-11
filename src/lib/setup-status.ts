"use client";

import { useCallback, useEffect, useState } from "react";

const KEY_SKIPPED = "neon-advisor:setup-skipped";
const MIN_CHECK_MS = 450;

export interface EnvConfig {
  orgId: string | null;
  orgName: string | null;
  sourceProjectId: string | null;
  targetProjectId: string | null;
  hasSourceConnection: boolean;
  hasTargetConnection: boolean;
  hasApiKey: boolean;
  sourceIsPooled: boolean;
}

export type RequirementId =
  | "apiKey"
  | "orgId"
  | "sourceConnection"
  | "sourceProject";

export interface Requirement {
  id: RequirementId;
  envVar: string;
  label: string;
  detail: string;
  satisfied: boolean;
  invalid?: string;
  optional?: boolean;
}

export interface SetupStatus {
  loading: boolean;
  initializing: boolean;
  error: string | null;
  env: EnvConfig | null;
  requirements: Requirement[];
  ready: boolean;
  skipped: boolean;
  skip: () => void;
  unskip: () => void;
  refresh: () => Promise<Requirement[]>;
}

export function isSetupSkipped(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY_SKIPPED) === "1";
}

export function setSetupSkipped(v: boolean) {
  if (typeof window === "undefined") return;
  if (v) window.localStorage.setItem(KEY_SKIPPED, "1");
  else window.localStorage.removeItem(KEY_SKIPPED);
}

export function buildRequirements(env: EnvConfig | null): Requirement[] {
  return [
    {
      id: "apiKey",
      envVar: "NEON_API_KEY",
      label: "API key",
      detail: "Lists your projects, provisions targets, enables replication.",
      satisfied: Boolean(env?.hasApiKey),
    },
    {
      id: "orgId",
      envVar: "NEON_ORG_ID",
      label: "org",
      detail: "Scopes the project list. Personal accounts can leave it blank.",
      satisfied: Boolean(env?.orgId),
      optional: true,
    },
    {
      id: "sourceProject",
      envVar: "NEON_SOURCE_PROJECT_ID",
      label: "default source",
      detail: "Skips the project picker. Otherwise you choose one in the app.",
      satisfied: Boolean(env?.sourceProjectId),
      optional: true,
    },
    {
      id: "sourceConnection",
      envVar: "NEON_SOURCE_CONNECTION_STRING",
      label: "direct connection",
      detail: "Only if you'd rather not have the app fetch it from the API.",
      satisfied: Boolean(env?.hasSourceConnection) && !env?.sourceIsPooled,
      invalid: env?.sourceIsPooled
        ? "Pooled host. Logical replication needs the direct endpoint: remove -pooler."
        : undefined,
      optional: true,
    },
  ];
}

export function useSetupStatus(): SetupStatus {
  const [env, setEnv] = useState<EnvConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkippedState] = useState(isSetupSkipped);

  const load = useCallback(async (): Promise<EnvConfig> => {
    const started = Date.now();
    try {
      const res = await fetch("/api/neon/config", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Configuration check failed (${res.status})`);
      }
      return (await res.json()) as EnvConfig;
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < MIN_CHECK_MS) {
        await new Promise((r) => setTimeout(r, MIN_CHECK_MS - elapsed));
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (cancelled) return;
        setEnv(data);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not check Neon configuration",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setSkippedState(isSetupSkipped());
    try {
      const data = await load();
      setEnv(data);
      setError(null);
      return buildRequirements(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not check Neon configuration",
      );
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [load]);

  /* A brief dev-server restart or network blip should not strand the user on
     the setup page. Retry when they return to the tab after a failed check. */
  useEffect(() => {
    if (!error) return;
    const retryOnFocus = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener("focus", retryOnFocus);
    return () => window.removeEventListener("focus", retryOnFocus);
  }, [error, refresh]);

  const skip = useCallback(() => {
    setSetupSkipped(true);
    setSkippedState(true);
  }, []);

  const unskip = useCallback(() => {
    setSetupSkipped(false);
    setSkippedState(false);
  }, []);

  const requirements = buildRequirements(env);

  return {
    loading,
    initializing,
    error,
    env,
    requirements,
    ready: !error && requirements.every((r) => r.optional || r.satisfied),
    skipped,
    skip,
    unskip,
    refresh,
  };
}
