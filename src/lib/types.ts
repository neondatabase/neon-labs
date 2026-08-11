/* ──────────────────────────────────────────────────────────────
   Neon Postgres Version Upgrade Advisor — types
   ────────────────────────────────────────────────────────────── */

export type PgMajorVersion = 14 | 15 | 16 | 17 | 18;

export const NEON_SUPPORTED_VERSIONS: PgMajorVersion[] = [14, 15, 16, 17, 18];

/** Assessments are always produced by connecting to the source database and
    running read-only catalog queries. The offline collector/ZIP-upload path
    was removed: accepting customer archives is an unnecessary attack surface
    for a hosted deployment. */
export type AssessmentMethod = "direct";

export type CheckSeverity = "info" | "warning" | "blocker";
export type CheckStatus = "pass" | "warning" | "blocker";

/**
 * A breaking change / deprecation / behavior shift introduced in
 * a specific PG version. Each entry is keyed by the version it was
 * introduced in and applies when upgrading FROM a version below it
 * TO any version at or above it.
 */
export interface VersionChange {
  id: string;
  introducedIn: PgMajorVersion; // version where the change landed
  category:
    | "Breaking"
    | "Deprecation"
    | "Behavior"
    | "Removed"
    | "System catalog"
    | "Config"
    | "Extension"
    | "Prerequisite"
    | "Post-migration";
  title: string;
  description: string;
  detectionHint?: string; // what to look for in the collector bundle
  remediation: string;
  severity: CheckSeverity;
  docsUrl?: string;
}

/** Triggered version change with detection result */
export interface DetectedChange extends VersionChange {
  status: CheckStatus;
  detectedDetail?: string;
}

export interface AssessmentMetadata {
  assessmentDate: string;
  scriptVersion?: string;
  sourceVersion: PgMajorVersion;
  targetVersion: PgMajorVersion;
  pgVersionFull: string;
  database: string;
}

export interface AssessmentStats {
  databases: number;
  tables: number;
  indexes: number;
  totalSizeGb: number;
  extensionCount: number;
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  passCount: number;
}

export interface AssessmentResult {
  id: string;
  name: string;
  sourceVersion: PgMajorVersion;
  targetVersion: PgMajorVersion;
  method: AssessmentMethod;
  createdAt: string;
  upgradeScore: number; // 0-100, how clean the upgrade looks
  recommendedPath: UpgradePath;
  metadata: AssessmentMetadata;
  changes: DetectedChange[];
  extensions: ExtensionUsage[];
  stats: AssessmentStats;
}

export type UpgradePath = "dump-restore" | "logical-replication" | "import-assistant";

export interface ExtensionUsage {
  name: string;
  version: string;
  schema: string;
  neonStatus: ExtensionSupportStatus;
}

export type ExtensionSupportStatus =
  | "available"
  | "under_review"
  | "planned"
  | "not_supported";

export interface NeonExtension {
  name: string;
  status: ExtensionSupportStatus;
  pg16?: string;
  pg17?: string;
  comments?: string;
}

/** Map an UpgradePath to the migration-tool route in the app. */
export const UPGRADE_PATH_ROUTES: Record<UpgradePath, string> = {
  "logical-replication": "/migrate/replication",
  "dump-restore": "/migrate/dump-restore",
  "import-assistant": "/migrate/import-assistant",
};

/* ──────────────────────────────────────────────────────────────
   Logical replication automation
   ────────────────────────────────────────────────────────────── */

export interface ReplicationPreflight {
  source: {
    pgVersion: number;
    walLevel: string;
    logicalReplicationEnabled: boolean;
    tableCount: number;
    tablesWithoutPK: string[];
    roleHasReplication: boolean;
    rolname: string;
  };
  target: {
    pgVersion: number;
    schemaLoaded: boolean;
    schemaTableCount: number;
    existingSubscription: string | null;
  };
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface ReplicationSetupResult {
  publicationName: string;
  subscriptionName: string;
  tables: string[];
  startedAt: string;
  walLevelChanged: boolean;
  schemaCopied: boolean;
}

export interface ReplicationStatus {
  subscriptionName: string;
  subscribed: boolean;
  workerActive: boolean;
  receivedLsn: string | null;
  latestEndLsn: string | null;
  lagBytes: number | null;
  /** % progress of initial copy 0-100, null if not copying or already streaming */
  initialCopyProgress: number | null;
  state: "copying" | "streaming" | "stopped" | "unknown";
  perTable: { table: string; state: string }[];
}

/* ──────────────────────────────────────────────────────────────
   Replication monitoring — Neon's recommended health queries
   (see Logical replication monitoring docs)
   ────────────────────────────────────────────────────────────── */

export type TableReplicationState =
  | "Initialize"
  | "Data being copied"
  | "Finished table copy"
  | "Synchronized"
  | "Ready"
  | "Unknown";

export interface SubscriberMonitorRow {
  subscriptionId: number;
  subscriptionName: string;
  tableName: string;
  tableStatus: TableReplicationState;
  tableLsn: string | null;
}

export interface PublisherMonitorRow {
  slotName: string;
  confirmedFlushLsn: string;
  currentWalLsn: string;
  lsnDistance: number;
  lsnDistanceSize: string;
}

export interface ReplicationMonitor {
  subscriber: SubscriberMonitorRow[];
  publisher: PublisherMonitorRow[];
  /** True when every subscribed table reports "Ready" */
  initialReplicationComplete: boolean;
  /** SQL the panel ran, exposed so users can paste it into the Neon SQL editor */
  sql: {
    subscriber: string;
    publisher: string;
  };
}

/* ──────────────────────────────────────────────────────────────
   Cutover — the moment writes flip from source → target
   ────────────────────────────────────────────────────────────── */

export interface SequenceDrift {
  sequence: string;
  table: string | null;
  column: string | null;
  sourceLastValue: number;
  targetLastValue: number;
  driftBy: number;
  /** Recommended new value on target to avoid PK collisions after cutover */
  recommendedTargetValue: number;
}

export interface RowCountCheck {
  table: string;
  sourceRows: number;
  targetRows: number;
  delta: number;
  match: boolean;
}

export interface CutoverPreflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  replicationLagBytes: number | null;
  allTablesStreaming: boolean;
  sequenceDrift: SequenceDrift[];
  rowCounts: RowCountCheck[];
  subscriptionEnabled: boolean;
}

export type CutoverStepStatus = "pending" | "running" | "ok" | "skipped" | "failed";

export interface CutoverStep {
  id: string;
  label: string;
  status: CutoverStepStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

/** Result of rebuilding optimizer statistics on the target. */
export interface AnalyzeTargetResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** User relations (tables, matviews, partitioned parents) on the target */
  relations: number;
  /** Relations that had never been analyzed, before this run */
  missingStatsBefore: number;
  /** Should be 0 — anything left is a relation ANALYZE couldn't touch */
  missingStatsAfter: number;
}

export interface CutoverResult {
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: CutoverStep[];
  sequencesReset: SequenceDrift[];
  finalLagBytes: number | null;
  newPrimaryConnectionString: string;
  /** Branded recommendation for the customer's next action */
  postCutoverActions: string[];
}

/* ──────────────────────────────────────────────────────────────
   Dump-restore — pg_dump | pg_restore migration path
   ────────────────────────────────────────────────────────────── */

export interface DumpRestorePreflight {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  source: {
    pgVersion: number;
    database: string;
    tableCount: number;
    estimatedSizeBytes: number;
    extensions: string[];
  };
  target: {
    pgVersion: number;
    database: string;
    isEmpty: boolean;
    existingTableCount: number;
  };
  generatedCommands: {
    schemaDump: string;
    dataDump: string;
    schemaRestore: string;
    dataRestore: string;
    pipelined: string;
  };
}

export interface DumpRestoreStep {
  id: string;
  label: string;
  status: "pending" | "running" | "ok" | "failed" | "skipped";
  detail?: string;
  durationMs?: number;
  rowsCopied?: number;
}

export interface DumpRestoreResult {
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: DumpRestoreStep[];
  rowCounts: RowCountCheck[];
  totalRowsCopied: number;
  totalBytesEstimate: number;
}

/* ──────────────────────────────────────────────────────────────
   Import Assistant — handoff to Neon Console
   ────────────────────────────────────────────────────────────── */

export interface ImportAssistantStatus {
  /** Project ID being imported into */
  projectId: string;
  /** What's actually in the target right now */
  tableCount: number;
  rowCountsByTable: { table: string; rows: number }[];
  totalRows: number;
  importStarted: boolean;
  importComplete: boolean;
  /** Deep-link to Neon Console's import page for this project */
  consoleUrl: string;
}

/* ──────────────────────────────────────────────────────────────
   Schema diff — source vs target catalog comparison
   ────────────────────────────────────────────────────────────── */

export type SchemaDiffOp = "added" | "removed" | "changed";
export type SchemaDiffKind =
  | "table"
  | "index"
  | "extension"
  | "view"
  | "function"
  | "column";

export interface SchemaDiffEntry {
  kind: SchemaDiffKind;
  op: SchemaDiffOp;
  identifier: string; // e.g. "public.orders.created_at"
  detail?: string; // e.g. "type changed: timestamp → timestamptz"
}
