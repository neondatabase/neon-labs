/* ──────────────────────────────────────────────────────────────
   Neon Postgres Version Upgrade Advisor — types
   ────────────────────────────────────────────────────────────── */

export type PgMajorVersion = 14 | 15 | 16 | 17 | 18;

export const NEON_SUPPORTED_VERSIONS: PgMajorVersion[] = [14, 15, 16, 17, 18];

export type AssessmentMethod = "script" | "direct";

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
