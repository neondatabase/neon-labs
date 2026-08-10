/* ──────────────────────────────────────────────────────────────
   Live introspection of a Neon project into AssessmentResult.
   Runs SQL against the source DB to detect which version-changes
   actually apply, plus collect stats and extensions.
   ────────────────────────────────────────────────────────────── */

import { Client } from "pg";
import { changesForUpgrade } from "./version-changes";
import { getExtensionStatus } from "./extensions";
import type {
  AssessmentResult,
  AssessmentStats,
  DetectedChange,
  ExtensionUsage,
  PgMajorVersion,
  UpgradePath,
} from "./types";

function clamp(v: number): PgMajorVersion {
  if (v <= 14) return 14;
  if (v === 15) return 15;
  if (v === 16) return 16;
  if (v === 17) return 17;
  return 18;
}

function pickPath(sizeGb: number): UpgradePath {
  if (sizeGb < 10) return "import-assistant";
  if (sizeGb < 200) return "dump-restore";
  return "logical-replication";
}

interface RawSnapshot {
  pgVersionFull: string;
  pgVersionMajor: number;
  database: string;
  totalSizeBytes: number;
  tableCount: number;
  indexCount: number;
  extensions: { name: string; version: string; schema: string }[];
  oldSnapshotThreshold: string | null;
  plpgsqlFuncCount: number;
  hasAdminpack: boolean;
  hasPgStatStatements: boolean;
  customCollations: number;
  publicSchemaWriters: number;
  hasForceParallelMode: boolean;
  // PG18 detections
  md5Roles: number;
  partitionedTableCount: number;
  afterTriggerCount: number;
  hasGeneratedColumns: number;
  passwordEncryption: string | null;
  preparedTxnCount: number;
  streamingReplicaCount: number;
  eventTriggerCount: number;
  tablesWithoutPkCount: number;
  unloggedPartitionedCount: number;
}

async function snapshot(connectionString: string): Promise<RawSnapshot> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const v = await client.query<{ version: string; num: string; db: string }>(
      "SELECT version() AS version, current_setting('server_version_num') AS num, current_database() AS db",
    );
    const num = parseInt(v.rows[0].num, 10);
    const major = Math.floor(num / 10000);

    const sizeRes = await client.query<{ bytes: string }>(
      "SELECT pg_database_size(current_database())::text AS bytes",
    );

    const counts = await client.query<{ tables: string; indexes: string }>(`
      SELECT
        (SELECT count(*)::text FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog','information_schema')
            AND table_type = 'BASE TABLE') AS tables,
        (SELECT count(*)::text FROM pg_indexes
          WHERE schemaname NOT IN ('pg_catalog','information_schema')) AS indexes
    `);

    const extRes = await client.query<{
      extname: string;
      extversion: string;
      nspname: string;
    }>(`
      SELECT e.extname, e.extversion, n.nspname
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
      ORDER BY e.extname
    `);

    // settings — fetch many at once and filter
    const settings = await client.query<{ name: string; setting: string }>(`
      SELECT name, setting FROM pg_settings
      WHERE name IN ('old_snapshot_threshold','force_parallel_mode')
    `);
    const settingsMap = new Map(settings.rows.map((r) => [r.name, r.setting]));

    const fnCount = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE l.lanname = 'plpgsql'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.deptype = 'e'
        )
    `);

    const collations = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_collation
      WHERE collnamespace NOT IN (
        SELECT oid FROM pg_namespace WHERE nspname IN ('pg_catalog','information_schema')
      )
    `);

    // Exclude Neon-managed roles (neon_superuser, cloud_admin, neondb_owner)
    // and PG built-ins. Customer-app roles are everything else.
    const publicWriters = await client.query<{ n: string }>(`
      SELECT count(DISTINCT grantee)::text AS n FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND privilege_type IN ('INSERT','UPDATE','DELETE')
        AND grantee NOT IN ('PUBLIC','postgres','neondb_owner','neon_superuser','cloud_admin')
        AND grantee NOT LIKE 'pg\\_%' ESCAPE '\\'
    `);

    // PG18 catalog checks
    // MD5 password detection: rolpassword starts with 'md5' (versus 'SCRAM-SHA-256$...').
    // pg_shadow is restricted, but we can read pg_authid columns via current_setting on
    // newer PGs or fall back to 0 if denied.
    const md5RolesQ = await client
      .query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_authid
         WHERE rolpassword IS NOT NULL AND rolpassword LIKE 'md5%'`,
      )
      .catch(() => ({ rows: [{ n: "0" }] }));

    const partitionedQ = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_class
      WHERE relkind = 'p' AND relnamespace = 'public'::regnamespace
    `);

    const afterTriggerQ = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND (t.tgtype & 2) = 0  -- AFTER (BEFORE has bit 2 set)
    `);

    // Generated columns: attgenerated is 's' for STORED in PG14-17 (only mode).
    // PG18 adds 'v' for VIRTUAL. We just want to count any generated cols so
    // we can warn about the changed default.
    const genColsQ = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND a.attgenerated <> ''
        AND NOT a.attisdropped
        AND a.attnum > 0
    `);

    const passwordEncryption =
      (await client.query<{ s: string }>(
        "SELECT current_setting('password_encryption', true) AS s",
      )).rows[0]?.s ?? null;

    const preparedTxnQ = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_prepared_xacts",
    );

    const streamingReplicaQ = await client
      .query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_stat_replication",
      )
      .catch(() => ({ rows: [{ n: "0" }] }));

    const eventTriggerQ = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_event_trigger",
    );

    const tablesWithoutPkQ = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint k
          WHERE k.conrelid = c.oid AND k.contype = 'p'
        )
    `);

    const unloggedPartitionedQ = await client.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relkind = 'p'
        AND c.relpersistence = 'u'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
    `);

    return {
      pgVersionFull: v.rows[0].version,
      pgVersionMajor: major,
      database: v.rows[0].db,
      totalSizeBytes: parseInt(sizeRes.rows[0].bytes, 10),
      tableCount: parseInt(counts.rows[0].tables, 10),
      indexCount: parseInt(counts.rows[0].indexes, 10),
      extensions: extRes.rows.map((r) => ({
        name: r.extname,
        version: r.extversion,
        schema: r.nspname,
      })),
      oldSnapshotThreshold: settingsMap.get("old_snapshot_threshold") ?? null,
      plpgsqlFuncCount: parseInt(fnCount.rows[0].n, 10),
      hasAdminpack: extRes.rows.some((r) => r.extname === "adminpack"),
      hasPgStatStatements: extRes.rows.some(
        (r) => r.extname === "pg_stat_statements",
      ),
      customCollations: parseInt(collations.rows[0].n, 10),
      publicSchemaWriters: parseInt(publicWriters.rows[0].n, 10),
      hasForceParallelMode: settingsMap.has("force_parallel_mode"),
      md5Roles: parseInt(md5RolesQ.rows[0].n, 10),
      partitionedTableCount: parseInt(partitionedQ.rows[0].n, 10),
      afterTriggerCount: parseInt(afterTriggerQ.rows[0].n, 10),
      hasGeneratedColumns: parseInt(genColsQ.rows[0].n, 10),
      passwordEncryption,
      preparedTxnCount: parseInt(preparedTxnQ.rows[0].n, 10),
      streamingReplicaCount: parseInt(streamingReplicaQ.rows[0].n, 10),
      eventTriggerCount: parseInt(eventTriggerQ.rows[0].n, 10),
      tablesWithoutPkCount: parseInt(tablesWithoutPkQ.rows[0].n, 10),
      unloggedPartitionedCount: parseInt(unloggedPartitionedQ.rows[0].n, 10),
    };
  } finally {
    await client.end();
  }
}

function detect(
  snap: RawSnapshot,
  source: PgMajorVersion,
  target: PgMajorVersion,
): DetectedChange[] {
  const applicable = changesForUpgrade(source, target);
  return applicable.map((change): DetectedChange => {
    let status: DetectedChange["status"] =
      change.severity === "info" ? "pass" : "warning";
    let detectedDetail: string | undefined;

    switch (change.id) {
      case "prereq-no-prepared-transactions": {
        if (snap.preparedTxnCount > 0) {
          status = "blocker";
          detectedDetail = `${snap.preparedTxnCount} prepared transaction${snap.preparedTxnCount === 1 ? "" : "s"} outstanding`;
        } else {
          status = "pass";
          detectedDetail = "0 prepared transactions outstanding";
        }
        break;
      }
      case "prereq-streaming-replicas-rebuild": {
        if (snap.streamingReplicaCount > 0) {
          status = "warning";
          detectedDetail = `${snap.streamingReplicaCount} streaming replica${snap.streamingReplicaCount === 1 ? "" : "s"} attached to source`;
        } else {
          status = "pass";
          detectedDetail = "0 streaming replicas attached";
        }
        break;
      }
      case "prereq-event-triggers-audit": {
        if (snap.eventTriggerCount > 0) {
          status = "warning";
          detectedDetail = `${snap.eventTriggerCount} event trigger${snap.eventTriggerCount === 1 ? "" : "s"} defined — disable any that shouldn't fire during migration`;
        } else {
          status = "pass";
          detectedDetail = "0 event triggers defined";
        }
        break;
      }
      case "prereq-tables-without-pk-logical": {
        if (snap.tablesWithoutPkCount > 0) {
          status = "warning";
          detectedDetail = `${snap.tablesWithoutPkCount} table${snap.tablesWithoutPkCount === 1 ? "" : "s"} without a primary key — only matters if you use logical replication`;
        } else {
          status = "pass";
          detectedDetail = "All tables have primary keys";
        }
        break;
      }
      case "post-analyze-target-statistics": {
        // Always applies — nothing on the source can clear this, since the
        // gap is on the target side. The count tells the user how much
        // ANALYZE work the cutover window needs to budget for.
        status = "warning";
        detectedDetail =
          snap.tableCount > 0
            ? `${snap.tableCount} table${snap.tableCount === 1 ? "" : "s"} will land on the target with no statistics — plan an ANALYZE before cutover`
            : "Target starts with no statistics — plan an ANALYZE before cutover";
        break;
      }
      case "pg17-old-snapshot-threshold-removed": {
        // PG14 uses "-1" for disabled; PG15+ uses "0". Both = no impact.
        // Only flag if a real (positive) threshold is configured.
        const v = snap.oldSnapshotThreshold;
        const parsed = v === null ? 0 : parseInt(v, 10);
        if (parsed > 0) {
          status = "blocker";
          detectedDetail = `old_snapshot_threshold = ${v}`;
        } else {
          status = "pass";
          detectedDetail = `disabled (${v ?? "unset"})`;
        }
        break;
      }
      case "pg17-search-path-maintenance":
        if (snap.plpgsqlFuncCount > 0) {
          status = "warning";
          detectedDetail = `${snap.plpgsqlFuncCount} user-defined PL/pgSQL functions — audit those used in expression indexes / matviews`;
        } else {
          status = "pass";
        }
        break;
      case "pg17-adminpack-removed":
        if (snap.hasAdminpack) {
          status = "blocker";
          detectedDetail = "adminpack extension installed";
        } else {
          status = "pass";
        }
        break;
      case "pg17-pg-stat-statements-renamed-cols":
        if (snap.hasPgStatStatements) {
          status = "warning";
          detectedDetail =
            "pg_stat_statements detected — review monitoring dashboards";
        } else {
          status = "pass";
        }
        break;
      case "pg15-public-schema-no-create":
        if (snap.publicSchemaWriters > 0) {
          status = "blocker";
          detectedDetail = `${snap.publicSchemaWriters} non-default roles with writes to public schema`;
        } else {
          status = "pass";
        }
        break;
      case "pg15-stats-collector-removed":
        status = "pass";
        break;
      case "pg16-default-collation-icu":
        if (snap.customCollations > 0) {
          status = "warning";
          detectedDetail = `${snap.customCollations} custom collations in use`;
        } else {
          status = "pass";
        }
        break;
      case "pg17-collation-rename":
        if (snap.customCollations > 0) {
          status = "warning";
          detectedDetail = `${snap.customCollations} custom collations — verify introspection`;
        } else {
          status = "pass";
        }
        break;
      case "pg18-virtual-generated-columns-default":
        if (snap.hasGeneratedColumns > 0) {
          status = "warning";
          detectedDetail = `${snap.hasGeneratedColumns} generated column${snap.hasGeneratedColumns === 1 ? "" : "s"} — existing tables keep their STORED/VIRTUAL setting, but new DDL needs explicit STORED if you rely on materialization`;
        } else {
          status = "pass";
          detectedDetail = "No generated columns in source";
        }
        break;
      case "pg18-unlogged-partitioned-tables-disallowed":
        if (snap.unloggedPartitionedCount > 0) {
          status = "warning";
          detectedDetail = `${snap.unloggedPartitionedCount} unlogged partitioned table${snap.unloggedPartitionedCount === 1 ? "" : "s"} found — existing definitions still load on PG18, but the DDL pattern is now rejected`;
        } else {
          status = "pass";
          detectedDetail = "No unlogged partitioned tables";
        }
        break;
      case "prereq-extensions-neon-compatibility": {
        const unsupportedExts: string[] = [];
        const underReviewExts: string[] = [];
        const unknownExts: string[] = [];
        for (const ext of snap.extensions) {
          if (!ext.name || ext.name === "plpgsql") continue;
          const ne = getExtensionStatus(ext.name);
          if (!ne) unknownExts.push(ext.name);
          else if (ne.status === "not_supported") unsupportedExts.push(ext.name);
          else if (ne.status === "under_review") underReviewExts.push(ext.name);
        }
        const flagged =
          unsupportedExts.length + underReviewExts.length + unknownExts.length;
        if (flagged === 0) {
          status = "pass";
          detectedDetail = "All installed extensions are supported on Neon";
        } else {
          status = "warning";
          const parts: string[] = [];
          if (unsupportedExts.length > 0) {
            parts.push(
              `${unsupportedExts.length} not supported (${unsupportedExts.slice(0, 5).join(", ")}${unsupportedExts.length > 5 ? "…" : ""})`,
            );
          }
          if (underReviewExts.length > 0) {
            parts.push(
              `${underReviewExts.length} under review (${underReviewExts.slice(0, 5).join(", ")}${underReviewExts.length > 5 ? "…" : ""})`,
            );
          }
          if (unknownExts.length > 0) {
            parts.push(
              `${unknownExts.length} not in catalog (${unknownExts.slice(0, 5).join(", ")}${unknownExts.length > 5 ? "…" : ""})`,
            );
          }
          detectedDetail = parts.join("; ");
        }
        break;
      }
      case "pg15-snake-case-config":
        if (snap.hasForceParallelMode) {
          status = "warning";
          detectedDetail = "force_parallel_mode present, rename in tooling";
        } else {
          status = "pass";
        }
        break;
      case "pg18-md5-deprecated":
        if (snap.md5Roles > 0) {
          status = "warning";
          detectedDetail = `${snap.md5Roles} role(s) still using MD5 password hashes${
            snap.passwordEncryption
              ? ` (cluster password_encryption=${snap.passwordEncryption})`
              : ""
          }`;
        } else if (snap.passwordEncryption === "md5") {
          status = "warning";
          detectedDetail =
            "No MD5 roles yet but password_encryption=md5, new passwords will hash as MD5";
        } else {
          status = "pass";
          detectedDetail = snap.passwordEncryption
            ? `password_encryption=${snap.passwordEncryption}`
            : undefined;
        }
        break;
      case "pg18-unlogged-partitioned-tables-disallowed":
        if (snap.partitionedTableCount > 0) {
          status = "warning";
          detectedDetail = `${snap.partitionedTableCount} partitioned table(s), audit DDL for UNLOGGED`;
        } else {
          status = "pass";
        }
        break;
      case "pg18-after-trigger-role-change":
        if (snap.afterTriggerCount > 0) {
          status = "warning";
          detectedDetail = `${snap.afterTriggerCount} AFTER trigger(s) in public schema, audit any role switches between statement and COMMIT`;
        } else {
          status = "pass";
        }
        break;
      case "pg18-virtual-generated-columns-default":
        if (snap.hasGeneratedColumns > 0) {
          status = "warning";
          detectedDetail = `${snap.hasGeneratedColumns} generated column(s) detected, future DDL needs explicit STORED if you want them materialized`;
        } else {
          status = "pass";
        }
        break;
      default:
        status = change.severity === "info" ? "pass" : "warning";
    }

    return { ...change, status, detectedDetail };
  });
}

/** The source turned out to be at or past the requested target. Producing an
    assessment here would describe an upgrade that is not happening. */
export class NotAnUpgradeError extends Error {
  constructor(
    readonly sourceVersion: number,
    readonly targetVersion: number,
  ) {
    super(
      `This project already runs PG ${sourceVersion}, so upgrading to PG ${targetVersion} is not an upgrade. Pick a target above PG ${sourceVersion}.`,
    );
    this.name = "NotAnUpgradeError";
  }
}

export async function introspectAssessment(
  connectionString: string,
  targetVersion: PgMajorVersion,
  meta: { projectId?: string; projectName?: string },
): Promise<AssessmentResult> {
  const snap = await snapshot(connectionString);
  const sourceVersion = clamp(snap.pgVersionMajor);
  if (targetVersion <= sourceVersion) {
    throw new NotAnUpgradeError(sourceVersion, targetVersion);
  }
  const target = targetVersion;
  const changes = detect(snap, sourceVersion, target);
  const totalSizeGb = Math.round((snap.totalSizeBytes / 1e9) * 100) / 100;

  const extensions: ExtensionUsage[] = snap.extensions.map((e) => {
    const status = getExtensionStatus(e.name);
    return {
      name: e.name,
      version: e.version,
      schema: e.schema,
      neonStatus: status?.status ?? "under_review",
    };
  });

  const blockerCount = changes.filter((c) => c.status === "blocker").length;
  const warningCount = changes.filter((c) => c.status === "warning").length;
  const passCount = changes.filter((c) => c.status === "pass").length;
  const infoCount = changes.filter((c) => c.severity === "info").length;

  const upgradeScore = Math.max(
    0,
    Math.round(100 - blockerCount * 20 - warningCount * 5),
  );

  const stats: AssessmentStats = {
    databases: 1,
    tables: snap.tableCount,
    indexes: snap.indexCount,
    totalSizeGb,
    extensionCount: extensions.length,
    blockerCount,
    warningCount,
    infoCount,
    passCount,
  };

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `live-${Date.now().toString(36)}`,
    name: meta.projectName
      ? `${meta.projectName}: PG ${sourceVersion} → PG ${target}`
      : `PG ${sourceVersion} → PG ${target}`,
    sourceVersion,
    targetVersion: target,
    method: "direct",
    createdAt: new Date().toISOString(),
    upgradeScore,
    recommendedPath: pickPath(totalSizeGb),
    metadata: {
      assessmentDate: new Date().toISOString(),
      sourceVersion,
      targetVersion: target,
      pgVersionFull: snap.pgVersionFull,
      database: snap.database,
    },
    changes,
    extensions,
    stats,
  };
}
