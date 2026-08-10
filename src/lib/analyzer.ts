import type {
  AssessmentResult,
  DetectedChange,
  PgMajorVersion,
  UpgradePath,
} from "./types";
import { getExtensionStatus } from "./extensions";
import { changesForUpgrade } from "./version-changes";

/* ──────────────────────────────────────────────────────────────
   Collector bundle parsing & upgrade impact detection
   ────────────────────────────────────────────────────────────── */

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+)/g) ?? [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").replace(/^"|"$/g, "").trim();
    });
    return row;
  });
}

function readFile(files: Map<string, string>, name: string): string {
  for (const [path, content] of files) {
    if (path.endsWith(name)) return content;
  }
  return "";
}

function countCsvRows(text: string): number {
  const lines = text.trim().split("\n");
  return Math.max(0, lines.length - 1);
}

function clampPgVersion(v: number): PgMajorVersion {
  if (v <= 14) return 14;
  if (v === 15) return 15;
  if (v === 16) return 16;
  if (v === 17) return 17;
  return 18;
}

/**
 * Heuristically map a parsed bundle to detected version-change impacts.
 * Each known change either flags itself based on bundle contents or
 * reports "info" if there's nothing concrete to detect (the change
 * still applies but no direct usage was found).
 */
function detectChanges(
  files: Map<string, string>,
  source: PgMajorVersion,
  target: PgMajorVersion,
): DetectedChange[] {
  const applicable = changesForUpgrade(source, target);
  const settings = parseCsv(readFile(files, "settings.csv"));
  const functions = parseCsv(readFile(files, "functions.csv"));
  const extensions = parseCsv(readFile(files, "extensions.csv"));
  const collations = parseCsv(readFile(files, "collations.csv"));
  const eventTriggers = countCsvRows(readFile(files, "event_triggers.csv"));
  const preparedTxnCount = countCsvRows(
    readFile(files, "prepared_transactions.csv"),
  );
  const streamingReplicaCount = countCsvRows(
    readFile(files, "streaming_replicas.csv"),
  );
  const tablesWithoutPkCount = countCsvRows(
    readFile(files, "tables_without_pk.csv"),
  );
  const generatedColumnCount = countCsvRows(
    readFile(files, "generated_columns.csv"),
  );
  const unloggedRows = parseCsv(readFile(files, "unlogged_tables.csv"));
  const partitionRows = parseCsv(readFile(files, "partitions.csv"));
  const partitionKeys = new Set(
    partitionRows.map((r) => `${r.schema}.${r.parent_table}`),
  );
  const unloggedPartitionedCount = unloggedRows.filter((r) =>
    partitionKeys.has(`${r.schema}.${r.table_name}`),
  ).length;
  const tableCount = Number.parseInt(
    (parseCsv(readFile(files, "object_counts.csv"))[0] ?? {}).tables ?? "0",
    10,
  );

  const installedExtensions = parseCsv(readFile(files, "extensions.csv"));
  const unsupportedExts: string[] = [];
  const underReviewExts: string[] = [];
  const unknownExts: string[] = [];
  for (const ext of installedExtensions) {
    const name = ext.extname ?? ext.extension ?? "";
    if (!name || name === "plpgsql") continue;
    const status = getExtensionStatus(name);
    if (!status) {
      unknownExts.push(name);
    } else if (status.status === "not_supported") {
      unsupportedExts.push(name);
    } else if (status.status === "under_review") {
      underReviewExts.push(name);
    }
  }

  function hasSetting(name: string): string | null {
    return settings.find((s) => s.name === name)?.setting ?? null;
  }

  return applicable.map((change): DetectedChange => {
    let status = change.severity === "info" ? "pass" : "warning";
    let detectedDetail: string | undefined;

    switch (change.id) {
      case "prereq-no-prepared-transactions": {
        if (preparedTxnCount > 0) {
          status = "blocker";
          detectedDetail = `${preparedTxnCount} prepared transaction${preparedTxnCount === 1 ? "" : "s"} outstanding`;
        } else {
          status = "pass";
        }
        break;
      }
      case "prereq-streaming-replicas-rebuild": {
        if (streamingReplicaCount > 0) {
          status = "warning";
          detectedDetail = `${streamingReplicaCount} streaming replica${streamingReplicaCount === 1 ? "" : "s"} attached to source`;
        } else {
          status = "pass";
          detectedDetail = "0 streaming replicas attached";
        }
        break;
      }
      case "prereq-event-triggers-audit": {
        if (eventTriggers > 0) {
          status = "warning";
          detectedDetail = `${eventTriggers} event trigger${eventTriggers === 1 ? "" : "s"} defined — disable any that shouldn't fire during migration`;
        } else {
          status = "pass";
          detectedDetail = "0 event triggers defined";
        }
        break;
      }
      case "prereq-tables-without-pk-logical": {
        if (tablesWithoutPkCount > 0) {
          status = "warning";
          detectedDetail = `${tablesWithoutPkCount} table${tablesWithoutPkCount === 1 ? "" : "s"} without a primary key — only matters if you use logical replication`;
        } else {
          status = "pass";
          detectedDetail = "All tables have primary keys";
        }
        break;
      }
      case "prereq-extensions-neon-compatibility": {
        const flaggedTotal =
          unsupportedExts.length + underReviewExts.length + unknownExts.length;
        if (flaggedTotal === 0) {
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
      case "post-analyze-target-statistics": {
        // Always applies — no migration path carries pg_statistic across, so
        // there is nothing in the bundle that could clear this. The detail
        // names the concrete surface so it doesn't read as boilerplate.
        status = "warning";
        detectedDetail =
          tableCount > 0
            ? `${tableCount} table${tableCount === 1 ? "" : "s"} will land on the target with no statistics — plan an ANALYZE before cutover`
            : "Target starts with no statistics — plan an ANALYZE before cutover";
        break;
      }
      case "pg17-old-snapshot-threshold-removed": {
        const v = hasSetting("old_snapshot_threshold");
        if (v && v !== "0") {
          status = "blocker";
          detectedDetail = `old_snapshot_threshold = ${v}`;
        } else {
          status = "pass";
        }
        break;
      }
      case "pg17-search-path-maintenance": {
        // Heuristic: any user-defined function in plpgsql could be referenced
        // by an expression index. Mark as warning if there are >0 functions.
        const userFns = functions.filter((f) =>
          f.language?.toLowerCase().includes("plpgsql"),
        ).length;
        if (userFns > 0) {
          status = "warning";
          detectedDetail = `${userFns} user-defined PL/pgSQL functions — audit those used in expression indexes / matviews`;
        } else {
          status = "pass";
        }
        break;
      }
      case "pg17-adminpack-removed": {
        const found = extensions.find((e) => e.extname === "adminpack");
        if (found) {
          status = "blocker";
          detectedDetail = "adminpack extension installed in source";
        } else {
          status = "pass";
        }
        break;
      }
      case "pg17-pg-stat-statements-renamed-cols": {
        const found = extensions.find((e) => e.extname === "pg_stat_statements");
        if (found) {
          status = "warning";
          detectedDetail = "pg_stat_statements detected — audit dashboards";
        } else {
          status = "pass";
        }
        break;
      }
      case "pg15-public-schema-no-create": {
        // Without role grants in bundle, treat as warning if source < 15.
        status = "warning";
        detectedDetail = "Review all roles that write to the public schema";
        break;
      }
      case "pg15-stats-collector-removed": {
        // Pure operational change — info unless we see custom monitoring hints.
        status = "info" as never;
        break;
      }
      case "pg16-default-collation-icu": {
        if (collations.length > 0) {
          status = "warning";
          detectedDetail = `${collations.length} custom collations in use`;
        } else {
          status = "pass";
        }
        break;
      }
      case "pg17-collation-rename": {
        if (collations.length > 0) {
          status = "warning";
          detectedDetail = `${collations.length} custom collations — verify introspection`;
        } else {
          status = "pass";
        }
        break;
      }
      case "pg18-virtual-generated-columns-default": {
        if (generatedColumnCount > 0) {
          status = "warning";
          detectedDetail = `${generatedColumnCount} generated column${generatedColumnCount === 1 ? "" : "s"} — existing tables keep their STORED/VIRTUAL setting, but new DDL needs explicit STORED if you rely on materialization`;
        } else {
          status = "pass";
          detectedDetail = "No generated columns in source";
        }
        break;
      }
      case "pg18-unlogged-partitioned-tables-disallowed": {
        if (unloggedPartitionedCount > 0) {
          status = "warning";
          detectedDetail = `${unloggedPartitionedCount} unlogged partitioned table${unloggedPartitionedCount === 1 ? "" : "s"} found — existing definitions still load on PG18, but the DDL pattern is now rejected`;
        } else {
          status = "pass";
          detectedDetail = "No unlogged partitioned tables";
        }
        break;
      }
      default:
        // Default: warnings/blockers stay as their severity, info passes.
        status = change.severity === "info" ? "pass" : "warning";
    }

    return {
      ...change,
      status: status as DetectedChange["status"],
      detectedDetail,
    };
  });
}

function pickUpgradePath(sizeGb: number): UpgradePath {
  if (sizeGb < 10) return "import-assistant";
  if (sizeGb < 200) return "dump-restore";
  return "logical-replication";
}

export function analyzeBundle(
  files: Map<string, string>,
  sourceVersion: PgMajorVersion,
  targetVersion: PgMajorVersion,
): AssessmentResult {
  const metadataRaw = readFile(files, "metadata.json");
  const metadata = metadataRaw
    ? JSON.parse(metadataRaw)
    : {
        assessment_date: new Date().toISOString(),
        pg_version_major: String(sourceVersion),
        pg_version_full: `PostgreSQL ${sourceVersion}`,
        database: "postgres",
      };

  const detectedSource = clampPgVersion(
    parseInt(metadata.pg_version_major ?? String(sourceVersion), 10),
  );
  const effectiveSource = detectedSource ?? sourceVersion;

  const extensionsCsv = readFile(files, "extensions.csv");
  const extensions = parseCsv(extensionsCsv).map((row) => {
    const ext = getExtensionStatus(row.extname ?? row.extension ?? "");
    return {
      name: row.extname ?? row.extension ?? "",
      version: row.extversion ?? row.version ?? "",
      schema: row.schema ?? "public",
      neonStatus: ext?.status ?? ("under_review" as const),
    };
  });

  const changes = detectChanges(files, effectiveSource, targetVersion);

  const blockerCount = changes.filter((c) => c.status === "blocker").length;
  const warningCount = changes.filter((c) => c.status === "warning").length;
  const passCount = changes.filter((c) => c.status === "pass").length;
  const infoCount = changes.filter((c) => c.severity === "info").length;

  // Score: 100 - 20/blocker - 5/warning, floored at 0
  const upgradeScore = Math.max(
    0,
    Math.round(100 - blockerCount * 20 - warningCount * 5),
  );

  const objectCounts = parseCsv(readFile(files, "object_counts.csv"))[0] ?? {};
  const dbSizeCsv = readFile(files, "database_size.csv");
  const dbSizes = parseCsv(dbSizeCsv);
  const totalBytes = dbSizes.reduce(
    (sum, row) => sum + (parseInt(row.size_bytes ?? "0", 10) || 0),
    0,
  );
  const totalSizeGb = Math.round((totalBytes / 1e9) * 100) / 100;

  return {
    id: crypto.randomUUID(),
    name: `PG ${effectiveSource} → PG ${targetVersion} Upgrade`,
    sourceVersion: effectiveSource,
    targetVersion,
    method: "script",
    createdAt: metadata.assessment_date ?? new Date().toISOString(),
    upgradeScore,
    recommendedPath: pickUpgradePath(totalSizeGb),
    metadata: {
      assessmentDate: metadata.assessment_date ?? new Date().toISOString(),
      scriptVersion: metadata.script_version,
      sourceVersion: effectiveSource,
      targetVersion,
      pgVersionFull: metadata.pg_version_full ?? `PostgreSQL ${effectiveSource}`,
      database: metadata.database ?? "postgres",
    },
    changes,
    extensions,
    stats: {
      databases: dbSizes.length || 1,
      tables: parseInt(objectCounts.tables ?? "0", 10),
      indexes: parseInt(objectCounts.indexes ?? "0", 10),
      totalSizeGb,
      extensionCount: extensions.length,
      blockerCount,
      warningCount,
      infoCount,
      passCount,
    },
  };
}
