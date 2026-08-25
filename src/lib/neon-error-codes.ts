/* ──────────────────────────────────────────────────────────────
   Classify Postgres errors hit during replication/cutover into
   structured remediations with concrete next steps and optional
   one-click recovery actions the UI can offer.

   Error sources covered:
     - pg client errors with a SQLSTATE `code` field
     - Neon API plain text errors thrown by neonFetch()
     - Generic Error objects from elsewhere in the stack
   ────────────────────────────────────────────────────────────── */

import type {
  ReplicationSetupFailureContext,
  ReplicationSetupStage,
} from "./types";

export type RecoveryActionId =
  | "drop-orphan-slot"
  | "drop-orphan-subscription"
  | "enable-logical-replication"
  | "use-unpooled-connection"
  | "rerun-setup"
  | "rerun-preflight"
  | "open-settings"
  | "open-neon-console";

export interface RecoveryAction {
  id: RecoveryActionId;
  label: string;
  /** Optional payload the UI will send when the action is invoked */
  payload?: Record<string, unknown>;
}

export interface ClassifiedError {
  /** Short, human-readable title for the banner */
  title: string;
  /** The original error message, lightly cleaned up */
  raw: string;
  /** Plain-English explanation */
  explanation: string;
  /** Ordered list of concrete next steps the user can take */
  nextSteps: string[];
  /** Suggested one-click actions the UI can render */
  actions: RecoveryAction[];
  /** Severity hint for styling */
  severity: "warning" | "error" | "fatal";
  /** Detected SQLSTATE if available */
  code?: string;
  stage?: ReplicationSetupStage;
  resource?: string | null;
  retrySafe?: boolean;
  partialResources?: ReplicationSetupFailureContext["partialResources"];
}

interface ErrorLike {
  message?: string;
  code?: string;
  stage?: ReplicationSetupStage;
  resource?: string | null;
}

function asErrorLike(e: unknown): ErrorLike {
  if (e && typeof e === "object") return e as ErrorLike;
  return { message: String(e) };
}

export function sanitizeDatabaseError(message: string): string {
  return message
    .replace(
      /\b(postgres(?:ql)?:\/\/)([^@\s'"]+)@/gi,
      "$1[credentials-redacted]@",
    )
    .replace(/\bpassword\s*=\s*('[^']*'|"[^"]*"|[^\s]+)/gi, "password=[redacted]")
    .replace(
      /\bCONNECTION\s+('[^']*'|"[^"]*")/gi,
      "CONNECTION [redacted]",
    );
}

const setupStageTitles: Record<ReplicationSetupStage, string> = {
  "schema-copy": "Schema copy failed",
  "publication-create": "Publication creation failed",
  "subscription-create": "Subscription creation failed",
  verification: "Replication setup verification failed",
};

export function attachSetupFailureContext(
  classified: ClassifiedError,
  context: ReplicationSetupFailureContext,
): ClassifiedError {
  const partial = context.partialResources;
  const duplicateSlot =
    context.stage === "subscription-create" &&
    /replication slot ["']?[^"'\s]+["']?\s+already exists/i.test(
      classified.raw,
    );
  const extensionSchemaMismatch = classified.raw.match(
    /^Extension copy failed for (.+?)\. Extension is already installed in schema (.+?); source uses (.+?)\.$/i,
  );
  const nextSteps: string[] = [];
  if (partial?.subscription.state === "present") {
    nextSteps.push(
      "An existing target subscription was detected. Refresh the page to resume monitoring; do not run setup again.",
    );
  } else if (
    partial?.publication.state !== "absent" ||
    partial?.slot.state !== "absent"
  ) {
    nextSteps.push(
      duplicateSlot
        ? "Partial source replication resources must be removed in Setup recovery before setup can retry."
        : "Setup left replication resources behind. Review the exact resources in Setup recovery before retrying.",
    );
  } else if (context.retrySafe) {
    nextSteps.push(
      "No application-owned replication resources remain. Correct the error, then retry setup.",
    );
  } else {
    nextSteps.push(
      "Resource inspection could not prove that retrying is safe. Refresh and inspect replication resources before retrying.",
    );
  }
  if (extensionSchemaMismatch) {
    const [, extension, targetSchema, sourceSchema] =
      extensionSchemaMismatch;
    nextSteps.push(
      `On the target, move extension "${extension}" from schema "${targetSchema}" to "${sourceSchema}" if it is relocatable. Otherwise, use a fresh target or recreate the extension in "${sourceSchema}".`,
      "Retry setup after the target extension schema matches the source.",
    );
  } else {
    nextSteps.push(
      context.stage === "schema-copy"
        ? "Resolve the missing table, type, function, extension, or default-expression dependency named by the database error."
        : context.stage === "publication-create"
          ? "Resolve the source publication conflict before creating a new subscription."
          : context.stage === "subscription-create"
            ? "Resolve the target subscription or source replication-slot error before retrying."
            : "Re-run preflight after the resource state is clean.",
    );
  }

  return {
    ...classified,
    title: duplicateSlot
      ? "Existing replication slot"
      : extensionSchemaMismatch
        ? "Extension schema mismatch"
        : setupStageTitles[context.stage],
    explanation: duplicateSlot
      ? "PostgreSQL could not create the subscription because its source replication slot already exists. Complete setup recovery before retrying."
      : extensionSchemaMismatch
        ? `The target already has extension "${extensionSchemaMismatch[1]}" in schema "${extensionSchemaMismatch[2]}", but the source uses "${extensionSchemaMismatch[3]}". Setup stopped before recreating dependent custom types and tables.`
        : classified.explanation,
    stage: context.stage,
    resource: context.resource,
    retrySafe: context.retrySafe,
    partialResources: partial,
    nextSteps,
    actions: context.retrySafe
      ? [{ id: "rerun-setup", label: "Retry setup" }]
      : [],
  };
}

export function classifyError(e: unknown): ClassifiedError {
  const err = asErrorLike(e);
  const msg = sanitizeDatabaseError((err.message ?? "").trim());
  const code = err.code;
  const lower = msg.toLowerCase();

  if (err.stage) {
    return {
      title: setupStageTitles[err.stage],
      raw: msg || "Unknown database error",
      explanation:
        "Replication setup stopped at a known stage. No connection credentials are included in this message.",
      nextSteps: [],
      actions: [],
      severity: "error",
      code,
      stage: err.stage,
      resource: err.resource ?? null,
      retrySafe: false,
    };
  }

  // ── Replication slot already exists ──────────────────────────
  // ERROR: replication slot "xxx" already exists
  const slotExistsMatch = msg.match(
    /replication slot ["']?([^"'\s]+)["']?\s+already exists/i,
  );
  if (slotExistsMatch || code === "42710" || lower.includes("already exists") && lower.includes("replication slot")) {
    const slotName = slotExistsMatch?.[1] ?? "neon_advisor_sub";
    return {
      title: "Replication slot already exists on source",
      raw: msg,
      explanation:
        `A replication slot named "${slotName}" is already present on the source project. ` +
        `This usually happens when a previous setup attempt was interrupted or the subscription on the target was dropped without disabling the slot on the source first.`,
      nextSteps: [
        `Drop the orphan slot on source: click "Drop orphan slot" below, or run SELECT pg_drop_replication_slot('${slotName}') from the source's SQL editor`,
        "Re-run replication setup — the publication and subscription will be recreated cleanly",
        "If the slot is in use by another active subscription you didn't create, verify with: SELECT * FROM pg_replication_slots WHERE slot_name = '" + slotName + "'",
      ],
      actions: [
        { id: "drop-orphan-slot", label: "Drop orphan slot", payload: { slotName } },
        { id: "rerun-setup", label: "Re-run setup" },
      ],
      severity: "error",
      code: code ?? "42710",
    };
  }

  // ── Publication already exists ───────────────────────────────
  if (msg.match(/publication ["']?[^"']+["']?\s+already exists/i)) {
    return {
      title: "Publication already exists on source",
      raw: msg,
      explanation:
        "A publication with this name already exists. Setup is mostly idempotent for publications, but if you're seeing this error, the publication may have been created with different settings.",
      nextSteps: [
        "Run Teardown to drop the existing publication, then re-run setup",
        "Or inspect it: SELECT * FROM pg_publication WHERE pubname = 'neon_advisor_pub'",
      ],
      actions: [{ id: "rerun-setup", label: "Re-run setup" }],
      severity: "warning",
      code,
    };
  }

  // ── Subscription already exists ──────────────────────────────
  if (msg.match(/subscription ["']?[^"']+["']?\s+already exists/i)) {
    return {
      title: "Subscription already exists on target",
      raw: msg,
      explanation:
        "A subscription with this name already exists on the target. Setup attempted to create it again.",
      nextSteps: [
        "Run Teardown to drop the existing subscription and source publication, then re-run setup",
        "Or inspect: SELECT * FROM pg_subscription WHERE subname = 'neon_advisor_sub'",
      ],
      actions: [
        { id: "drop-orphan-subscription", label: "Drop orphan subscription" },
        { id: "rerun-setup", label: "Re-run setup" },
      ],
      severity: "error",
      code,
    };
  }

  // ── wal_level isn't logical ──────────────────────────────────
  if (lower.includes("wal_level") || lower.includes("logical decoding requires wal_level")) {
    return {
      title: "Logical replication isn't enabled on source",
      raw: msg,
      explanation:
        "The source Neon project has wal_level=replica. Logical replication requires wal_level=logical, which is irreversible and restarts source computes.",
      nextSteps: [
        "Go back to Step 02 on this page and click 'Enable on <project>' — that calls the Neon API to flip the setting and waits for the compute restart",
        "Verify after restart: SELECT current_setting('wal_level') on source should return 'logical'",
      ],
      actions: [
        { id: "enable-logical-replication", label: "Enable logical replication" },
        { id: "rerun-preflight", label: "Re-run preflight" },
      ],
      severity: "error",
      code,
    };
  }

  // ── REPLICATION privilege missing ────────────────────────────
  if (lower.includes("must be superuser or replication role") || lower.includes("permission denied for replication")) {
    return {
      title: "Connection role lacks REPLICATION privilege",
      raw: msg,
      explanation:
        "The role in your source connection string doesn't have the REPLICATION attribute. On Neon, roles created via the Console/CLI/API are members of neon_superuser which has REPLICATION by default — your connection string may be using a custom role without it.",
      nextSteps: [
        "Use the connection string for neondb_owner (or another role with REPLICATION) — check the Neon Console → Project → Roles",
        "Or grant it: ALTER ROLE <your_role> REPLICATION (must be done by a member of neon_superuser)",
      ],
      actions: [
        { id: "open-settings", label: "Update connection string" },
      ],
      severity: "error",
      code,
    };
  }

  // ── Pooler connection used for logical replication ───────────
  if (lower.includes("pgbouncer") || (lower.includes("pooler") && lower.includes("replication"))) {
    return {
      title: "Pooled connection is incompatible with logical replication",
      raw: msg,
      explanation:
        "Neon's pooled endpoints (hosts containing `-pooler`) use pgbouncer in transaction-pooling mode, which doesn't support the long-lived persistent connections logical replication needs.",
      nextSteps: [
        "Use the unpooled host — drop `-pooler` from the connection string hostname",
        "Example: ep-xyz-12345-pooler.region.neon.tech → ep-xyz-12345.region.neon.tech",
      ],
      actions: [
        { id: "use-unpooled-connection", label: "Switch to unpooled host" },
      ],
      severity: "error",
      code,
    };
  }

  // ── PK collision during initial copy ─────────────────────────
  if (code === "23505" || lower.includes("duplicate key value violates unique constraint")) {
    return {
      title: "Duplicate key during initial copy",
      raw: msg,
      explanation:
        "The subscription's per-table sync worker tried to INSERT a row whose primary key already exists on target. This typically happens when the target wasn't truly empty before setup ran, or a previous run partially copied data.",
      nextSteps: [
        "TRUNCATE the target tables and re-run setup (only safe if the target was intended to be a fresh copy)",
        "Or reset all sequences on target so future inserts won't collide, then ALTER SUBSCRIPTION ... REFRESH PUBLICATION",
      ],
      actions: [{ id: "rerun-setup", label: "Re-run setup" }],
      severity: "error",
      code: code ?? "23505",
    };
  }

  // ── Sequence reset DO block hit a null seq_name ─────────────
  // pg_get_serial_sequence returns NULL for columns whose default uses
  // nextval() but where the sequence isn't formally owned by the column.
  if (
    code === "22004" ||
    lower.includes("query string argument of execute is null")
  ) {
    return {
      title: "Sequence reset hit an unowned sequence",
      raw: msg,
      explanation:
        "The DO block that resets target sequences uses pg_get_serial_sequence(), which returns NULL when a column's nextval() default references a sequence that isn't formally owned by the column (no ALTER SEQUENCE OWNED BY). The newer cutover code parses the sequence name out of column_default as a fallback and skips truly unresolvable rows.",
      nextSteps: [
        "Re-run cutover — the NULL-guarded version of the DO block now resolves sequences from column_default when pg_get_serial_sequence is silent",
        "If it still fails, inspect: SELECT table_name, column_name, column_default FROM information_schema.columns WHERE column_default LIKE 'nextval%' AND pg_get_serial_sequence(table_schema || '.' || table_name, column_name) IS NULL",
      ],
      actions: [{ id: "rerun-preflight", label: "Re-run preflight" }],
      severity: "error",
      code: code ?? "22004",
    };
  }

  // ── Neon API auth failures ──────────────────────────────────
  if (msg.includes("Neon API 401") || msg.includes("Neon API 403")) {
    return {
      title: "Neon API authentication failed",
      raw: msg,
      explanation:
        "Your Neon OAuth session was rejected. It may have expired, been revoked, or lack access to the organization that owns this project.",
      nextSteps: [
        "Sign in with Neon again to refresh the authorization",
        "Make sure your Neon account has access to the organization that owns these projects",
      ],
      actions: [
        { id: "open-settings", label: "Sign in again" },
        { id: "open-neon-console", label: "Open Neon Console" },
      ],
      severity: "error",
      code,
    };
  }

  // ── Generic connection refused / DNS / timeout ──────────────
  if (
    lower.includes("connect etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo")
  ) {
    return {
      title: "Could not reach the database",
      raw: msg,
      explanation:
        "The connection attempt failed before any SQL ran. The endpoint may be suspended (Scale to Zero), the host may be unreachable from this network, or the connection string may be wrong.",
      nextSteps: [
        "Wait a few seconds and retry — Neon computes wake up on demand",
        "Verify the host is reachable: open the Neon Console and run a SELECT in the SQL editor",
        "Check the connection string in .env.local or the target picker",
      ],
      actions: [
        { id: "rerun-preflight", label: "Re-run preflight" },
        { id: "open-settings", label: "Check connection strings" },
      ],
      severity: "warning",
      code,
    };
  }

  // ── Fallback ─────────────────────────────────────────────────
  return {
    title: "Operation failed",
    raw: msg || "Unknown error",
    explanation:
      "The operation didn't complete. The raw error message is shown below.",
    nextSteps: [
      "Check the raw error for context",
      "Re-run the preceding step to confirm the system state",
      "Inspect the affected resource before retrying so a partial operation is not repeated.",
    ],
    actions: [{ id: "rerun-preflight", label: "Re-run preflight" }],
    severity: "error",
    code,
  };
}
