import type { PgMajorVersion, VersionChange } from "./types";

/* ──────────────────────────────────────────────────────────────
   Postgres breaking changes & deprecations by version.
   Sourced from official PG release notes:
     https://www.postgresql.org/docs/15/release-15.html
     https://www.postgresql.org/docs/16/release-16.html
     https://www.postgresql.org/docs/17/release-17.html
   ────────────────────────────────────────────────────────────── */

export const VERSION_CHANGES: VersionChange[] = [
  /* ── PG 15 ─────────────────────────────────────────────── */
  {
    id: "pg15-public-schema-no-create",
    introducedIn: 15,
    category: "Breaking",
    title: "Public schema CREATE privilege revoked from PUBLIC",
    description:
      "In PG 15+, the public schema no longer grants CREATE to all roles by default. Roles that previously relied on this default will get permission errors when creating objects in the public schema.",
    detectionHint: "Look for roles other than table owners writing to public schema",
    remediation:
      "Either grant the privilege explicitly (`GRANT CREATE ON SCHEMA public TO <role>`) or migrate objects to a per-tenant schema before upgrading.",
    severity: "blocker",
    docsUrl: "https://www.postgresql.org/docs/15/release-15.html",
  },
  {
    id: "pg15-snake-case-config",
    introducedIn: 15,
    category: "Config",
    title: "force_parallel_mode renamed to debug_parallel_query",
    description:
      "The server variable `force_parallel_mode` was renamed to `debug_parallel_query`. Scripts/dashboards that read this setting must be updated.",
    detectionHint: "Settings file references `force_parallel_mode`",
    remediation:
      "Rename references in your tooling. The variable is debug-only and should not be set in production.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/15/release-15.html",
  },
  {
    id: "pg15-stats-collector-removed",
    introducedIn: 15,
    category: "Behavior",
    title: "Statistics collector replaced with shared memory",
    description:
      "PG 15 removes the separate stats collector process. Stats are now stored in shared memory. External monitoring that scrapes pgstat files will break.",
    detectionHint: "Custom monitoring that reads pg_stat_tmp files",
    remediation:
      "Update monitoring to query `pg_stat_*` views via SQL instead of reading pgstat files.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/15/release-15.html",
  },
  {
    id: "pg15-merge-statement",
    introducedIn: 15,
    category: "Behavior",
    title: "New MERGE statement available",
    description:
      "PG 15 adds the SQL-standard `MERGE` statement. Existing UPSERT logic (`INSERT ... ON CONFLICT`) continues to work; consider migrating for clarity.",
    remediation: "Optional — refactor UPSERTs to MERGE for readability.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/15/release-15.html",
  },

  /* ── PG 16 ─────────────────────────────────────────────── */
  {
    id: "pg16-promote-trigger-file-removed",
    introducedIn: 16,
    category: "Removed",
    title: "promote_trigger_file removed",
    description:
      "PG 16 removes `promote_trigger_file`. Use `pg_promote()` instead. This is irrelevant on Neon (managed replication), but DDL/scripts may still reference it.",
    detectionHint: "Configuration or scripts using `promote_trigger_file`",
    remediation:
      "Remove `promote_trigger_file` from any postgresql.conf or migration tooling.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/16/release-16.html",
  },
  {
    id: "pg16-amcheck-changes",
    introducedIn: 16,
    category: "Behavior",
    title: "amcheck rewritten for heap verification",
    description:
      "The `amcheck` extension gained heap-level checks. Existing index-only checks still work but new heap checks may surface latent data issues.",
    remediation:
      "Run `pg_amcheck --heapallindexed` on the upgraded cluster to surface any corruption from the old version.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/16/release-16.html",
  },
  {
    id: "pg16-default-collation-icu",
    introducedIn: 16,
    category: "Breaking",
    title: "Default collation provider can be ICU",
    description:
      "PG 16 allows ICU as the default collation provider at initdb. Sort orders may differ from libc-based collations. Indexes on text columns may need REINDEX.",
    detectionHint: "Custom collations or text indexes",
    remediation:
      "Keep the source collation provider on the target. If switching, `REINDEX` all text indexes after upgrade.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/16/release-16.html",
  },
  {
    id: "pg16-logical-decoding-standby",
    introducedIn: 16,
    category: "Behavior",
    title: "Logical decoding now supported on standby",
    description:
      "PG 16+ allows logical replication slots on physical standbys. This unlocks more flexible CDC patterns.",
    remediation:
      "Optional — consider standby-based logical replication for analytics consumers.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/16/release-16.html",
  },

  /* ── PG 17 ─────────────────────────────────────────────── */
  {
    id: "pg17-search-path-maintenance",
    introducedIn: 17,
    category: "Breaking",
    title: "Maintenance functions require safe search_path",
    description:
      "PG 17 blocks unsafe `search_path` access during ANALYZE, CLUSTER, CREATE INDEX, REFRESH MATERIALIZED VIEW, REINDEX, and VACUUM. Functions used by expression indexes or materialized views that reference non-default schemas must set `search_path` explicitly.",
    detectionHint: "User-defined functions used in expression indexes / matviews",
    remediation:
      "Add `SET search_path = pg_catalog, public` (or your schema list) to function definitions used by indexes/matviews. Recreate affected indexes.",
    severity: "blocker",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-old-snapshot-threshold-removed",
    introducedIn: 17,
    category: "Removed",
    title: "old_snapshot_threshold removed",
    description:
      "The `old_snapshot_threshold` server variable was removed in PG 17. Configurations referencing it will fail to start.",
    detectionHint: "postgresql.conf or settings overrides containing `old_snapshot_threshold`",
    remediation: "Remove `old_snapshot_threshold` from any config before upgrading.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-regproc-cast",
    introducedIn: 17,
    category: "Breaking",
    title: "Stricter regproc / regprocedure casts",
    description:
      "Casts like `'now'::regproc` no longer succeed for non-unique function names. Use `'now'::regprocedure` with full signature, or cast to a qualified function name.",
    detectionHint: "Functions or queries casting strings to regproc",
    remediation:
      "Audit application SQL for `::regproc` casts. Switch ambiguous ones to `::regprocedure` with full signature.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-adminpack-removed",
    introducedIn: 17,
    category: "Removed",
    title: "adminpack contrib extension removed",
    description:
      "The `adminpack` extension is gone in PG 17. It wasn't supported on Neon anyway, but legacy migration scripts may reference it.",
    detectionHint: "`CREATE EXTENSION adminpack` in migration scripts",
    remediation: "Remove `adminpack` from dump files / migration tooling.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-pg-stat-statements-renamed-cols",
    introducedIn: 17,
    category: "System catalog",
    title: "pg_stat_statements I/O timing columns renamed",
    description:
      "Column names in `pg_stat_statements` for block I/O timing changed. Dashboards and queries referencing the old names will return errors.",
    detectionHint: "Custom dashboards on `pg_stat_statements`",
    remediation:
      "Update column references: `blk_read_time` → `shared_blk_read_time`, `blk_write_time` → `shared_blk_write_time`.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-pg-attribute-attstattarget",
    introducedIn: 17,
    category: "System catalog",
    title: "pg_attribute.attstattarget type change",
    description:
      "The `attstattarget` column is now nullable with a different default representation. Tools that introspect statistics targets must handle NULL.",
    detectionHint: "Custom tooling reading `pg_attribute.attstattarget`",
    remediation: "Update tooling to handle NULL in `attstattarget` (means default).",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-collation-rename",
    introducedIn: 17,
    category: "System catalog",
    title: "Collation locale columns renamed",
    description:
      "`pg_collation.colliculocale` → `colllocale`, `pg_database.daticulocale` → `datlocale`. Tooling that introspects collations must update.",
    remediation: "Update introspection SQL to use the new column names.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },
  {
    id: "pg17-wal-sync-method",
    introducedIn: 17,
    category: "Removed",
    title: "wal_sync_method=fsync_writethrough removed",
    description:
      "PG 17 removes the `fsync_writethrough` value for `wal_sync_method`. Managed by Neon, but config audits should flag.",
    remediation: "Remove `wal_sync_method=fsync_writethrough` from any config.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/17/release-17.html",
  },

  /* ── PG 18 ─────────────────────────────────────────────── */
  {
    id: "pg18-md5-deprecated",
    introducedIn: 18,
    category: "Deprecation",
    title: "MD5 password authentication deprecated",
    description:
      "PG 18 emits deprecation warnings on CREATE ROLE / ALTER ROLE that set MD5 passwords. MD5 will be removed in a future major. SCRAM-SHA-256 is the only authentication method that won't break in PG 19+.",
    detectionHint: "Roles with password_encryption='md5' or md5-hashed entries in pg_shadow.passwd",
    remediation:
      "Switch the cluster's `password_encryption` to `scram-sha-256` (Neon default), then have each user re-set their password so it's re-hashed with SCRAM. Audit application connection strings and drivers, anything older than libpq from PG 10 won't support SCRAM.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-copy-csv-eof-marker",
    introducedIn: 18,
    category: "Breaking",
    title: "COPY FROM no longer treats `\\.` as EOF in CSV files",
    description:
      "Previously COPY FROM treated a `\\.` token on its own line as end-of-file when reading CSV. PG 18 only honors this in psql's `\\copy ... FROM STDIN`. ETL pipelines and backup-restore scripts that emit `\\.` as a CSV record terminator will now ingest it as data.",
    detectionHint: "Application code or shell scripts that emit `\\.` as a CSV terminator",
    remediation:
      "Remove `\\.` markers from CSV files your apps produce. Use `\\copy ... FROM STDIN` (with a real EOF/pipe close) instead of treating `\\.` as a logical EOF.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-unlogged-partitioned-tables-disallowed",
    introducedIn: 18,
    category: "Breaking",
    title: "Unlogged partitioned tables now disallowed",
    description:
      "Previously `ALTER TABLE … SET UNLOGGED` on a partitioned table did nothing silently; creating an `UNLOGGED PARTITIONED TABLE` likewise didn't propagate. PG 18 explicitly rejects both. Existing definitions still load, but new DDL fails.",
    detectionHint: "Migration scripts containing `CREATE UNLOGGED ... PARTITION BY` or `ALTER TABLE ... SET UNLOGGED` on partitioned parents",
    remediation:
      "Remove `UNLOGGED` from partitioned-table DDL. If unlogged behavior was actually intended, create the children individually as unlogged.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-after-trigger-role-change",
    introducedIn: 18,
    category: "Behavior",
    title: "AFTER triggers now run as the role active when queued",
    description:
      "Previously AFTER triggers ran as whatever role was active at COMMIT time. PG 18 runs them as the role that was active when the trigger event was queued. Apps that use `SET ROLE` or `SECURITY DEFINER` between the trigger-firing statement and COMMIT will see different behavior.",
    detectionHint: "AFTER triggers combined with mid-transaction role switches",
    remediation:
      "Audit triggers that depend on the committing role. If you relied on the old behavior, pin the role inside the trigger function with `SET ROLE` explicitly.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-rule-privileges-removed",
    introducedIn: 18,
    category: "Removed",
    title: "Non-functional rule privileges removed from GRANT/REVOKE",
    description:
      "`GRANT/REVOKE ... ON RULE ...` has been non-functional since PG 8.2. PG 18 removes the syntax entirely. Legacy migration scripts that include these statements will now fail.",
    detectionHint: "SQL files containing `GRANT ... ON RULE` or `REVOKE ... ON RULE`",
    remediation: "Delete these statements from migrations, they did nothing anyway.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-pg-stat-wal-cols-removed",
    introducedIn: 18,
    category: "System catalog",
    title: "pg_stat_wal: read/sync columns removed",
    description:
      "PG 18 removes `wal_write_time`, `wal_sync_time`, and related counters from `pg_stat_wal`. Tracking of these timings moves into `pg_stat_io`, controlled by `track_wal_io_timing`. Dashboards and exporters that scrape these columns will return errors.",
    detectionHint: "Custom Grafana/Datadog queries on pg_stat_wal",
    remediation:
      "Update monitoring to read from `pg_stat_io` filtered to WAL operations. Enable `track_wal_io_timing` if you need the timing detail.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-pg-backend-memory-contexts-parent-removed",
    introducedIn: 18,
    category: "System catalog",
    title: "pg_backend_memory_contexts.parent removed, level is now 1-based",
    description:
      "The `parent` column is gone, replaced by the existing `path` column. The `level` column changed from 0-based to 1-based. Tools that walk the memory context tree need to adjust.",
    detectionHint: "Custom queries on `pg_backend_memory_contexts`",
    remediation:
      "Replace `parent` with `path[array_upper(path,1)-1]` and adjust any `level = 0` filters to `level = 1`.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-data-checksums-default",
    introducedIn: 18,
    category: "Config",
    title: "initdb enables data checksums by default",
    description:
      "PG 18 turns on `data_checksums` for all new clusters by default. On a Neon-to-Neon migration this is fully managed — the new project initializes with checksums on, and the dump/restore or logical-replication migration path naturally re-derives every page on the target. Minor write-path overhead (~1-2%) on workloads that weren't using checksums before.",
    detectionHint: "Source Neon project initialized before checksums became default",
    remediation:
      "Nothing to do on Neon — checksums are enabled on every new project automatically. Heads-up only.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-fts-collation-provider",
    introducedIn: 18,
    category: "Behavior",
    title: "Full-text search uses cluster's default collation provider",
    description:
      "Previously FTS always used libc for reading configuration files and dictionaries. PG 18 uses whatever the cluster's default collation provider is (libc, ICU, or builtin). Clusters on ICU may see different tokenization on locale-sensitive boundaries.",
    detectionHint: "Cluster with `default_collation_provider` = `icu` and tsvector columns",
    remediation:
      "Test FTS queries against a PG18 rehearsal branch. Reindex GIN/GiST text-search indexes if results differ.",
    severity: "info",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
  {
    id: "pg18-virtual-generated-columns-default",
    introducedIn: 18,
    category: "Breaking",
    title: "Generated columns default to VIRTUAL instead of STORED",
    description:
      "Pre-PG18, `GENERATED ALWAYS AS (...)` columns without explicit `STORED` were stored. PG 18 makes VIRTUAL the default. New DDL produces virtual columns unless you explicitly say `STORED`. Existing tables aren't affected.",
    detectionHint: "Migration scripts creating generated columns without STORED/VIRTUAL",
    remediation:
      "Add the explicit `STORED` keyword to any DDL that requires materialized values (e.g., for indexing the generated column).",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/18/release-18.html",
  },
];

/* ──────────────────────────────────────────────────────────────
   Version-independent checks that the Neon-to-Neon migration paths
   (dump/restore and logical replication) require regardless of which
   major version you are moving between. Mostly pre-upgrade
   prerequisites, plus the post-migration steps that are easy to skip
   and expensive to skip. They always apply.
   ────────────────────────────────────────────────────────────── */

export const PREREQUISITE_CHECKS: VersionChange[] = [
  {
    id: "prereq-no-prepared-transactions",
    introducedIn: 14,
    category: "Prerequisite",
    title: "No prepared (two-phase) transactions outstanding",
    description:
      "Prepared transactions block a clean dump/restore migration into a new Neon project, and logical replication will not replicate them either. Resolve any outstanding two-phase transactions on the source Neon project before migrating.",
    detectionHint: "pg_prepared_xacts is non-empty",
    remediation:
      "Resolve outstanding prepared transactions: `SELECT * FROM pg_prepared_xacts;` then `COMMIT PREPARED 'gid'` or `ROLLBACK PREPARED 'gid'` for each row.",
    severity: "blocker",
    docsUrl:
      "https://www.postgresql.org/docs/current/sql-prepare-transaction.html",
  },
  {
    id: "prereq-streaming-replicas-rebuild",
    introducedIn: 14,
    category: "Prerequisite",
    title: "External replicas / consumers attached to source",
    description:
      "Anything tailing the source Neon project's WAL — logical replication subscribers, CDC consumers, external read replicas — needs to be repointed at the new Neon project after cutover. Neon doesn't manage external standbys for you, so plan the consumer cutover alongside the application cutover.",
    detectionHint: "pg_stat_replication has connected standbys",
    remediation:
      "List active consumers in advance, drop their replication slots on the source after cutover, and rebuild the connection against the new Neon project. For dump/restore migrations, recreate any logical replication publications on the target.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/current/pgupgrade.html",
  },
  {
    id: "prereq-event-triggers-audit",
    introducedIn: 14,
    category: "Prerequisite",
    title: "Event triggers can interfere with upgrade tooling",
    description:
      "Event triggers fire on DDL events (and a few other server events). When migrating between Neon projects, replayed DDL on the target re-fires those triggers, which can fail or mutate the schema in unintended ways. Both dump/restore and logical-replication migration paths replay DDL, so any defined event trigger should be reviewed before cutover.",
    detectionHint: "pg_event_trigger non-empty",
    remediation:
      "Audit each event trigger with `SELECT evtname, evtevent, evtfoid::regproc FROM pg_event_trigger;`. Disable any that should not run during migration via `ALTER EVENT TRIGGER name DISABLE;` and re-enable after cutover.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/current/event-triggers.html",
  },
  {
    id: "prereq-tables-without-pk-logical",
    introducedIn: 14,
    category: "Prerequisite",
    title: "Tables without primary keys block logical replication",
    description:
      "Logical replication can replicate INSERTs without a primary key, but UPDATEs and DELETEs on a table without a PK or REPLICA IDENTITY error out, or silently break, depending on version. This applies to the Neon-to-Neon logical-replication migration path (and any future change-data-capture pipelines). Dump/restore migrations are unaffected.",
    detectionHint: "tables_without_pk.csv has any rows",
    remediation:
      "Either add primary keys (`ALTER TABLE … ADD PRIMARY KEY (...)`) or set REPLICA IDENTITY FULL on each affected table (`ALTER TABLE … REPLICA IDENTITY FULL;`). FULL is more expensive at write time but works without a PK.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/current/logical-replication-restrictions.html",
  },
  {
    id: "prereq-extensions-neon-compatibility",
    introducedIn: 14,
    category: "Prerequisite",
    title: "Installed extensions must be compatible with Neon",
    description:
      "Neon supports a curated set of Postgres extensions. Extensions installed on the source that Neon does not support need to be dropped from the source schema before dumping (or replaced with a Neon equivalent). Extensions under review may need to be enabled via a Neon support ticket. The Extensions tab in the assessment lists every installed extension with its Neon status.",
    detectionHint: "Cross-reference pg_extension rows against Neon's supported list",
    remediation:
      "For unsupported extensions: `DROP EXTENSION name CASCADE;` on the source after migrating any data that depends on the extension's types or functions. For 'under review' extensions: open a Neon support ticket to request enablement on your project before migrating.",
    severity: "warning",
    docsUrl: "https://neon.com/docs/extensions/pg-extensions",
  },
  {
    id: "post-analyze-target-statistics",
    introducedIn: 14,
    category: "Post-migration",
    title: "Optimizer statistics do not travel to the target",
    description:
      "Neither Neon migration path carries `pg_statistic` to the new project. Logical replication copies rows and streams changes, but statistics are never replicated. pg_dump only includes them if you explicitly pass `--statistics` (PG 18+ client), and never for extended statistics created with CREATE STATISTICS. PG 18's pg_upgrade does preserve most statistics, but that is irrelevant here: Neon major upgrades provision a new project rather than upgrading in place. So the target starts with no statistics, the planner falls back to default selectivity estimates, and it picks sequential scans and nested loops over tables it believes are tiny. Symptoms right after cutover: CPU pinned near 100%, queries that ran in milliseconds taking tens of seconds, connection pool exhaustion as slow queries stack up. Scaling compute does not rescue it — autoscaling to a higher CU ceiling just runs the same bad plan in more parallel workers, which is exactly why 'we scaled up and nothing helped' is the usual story. Autovacuum may not rescue it either: autoanalyze triggers on tuples changed since the last analyze, so a freshly loaded read-mostly table can sit below the threshold and stay slow indefinitely.",
    detectionHint:
      "Any freshly provisioned, restored, or replicated-into target project",
    remediation:
      "Run ANALYZE on every database in the target before you point production traffic at it — `vacuumdb --analyze-only --all`, or `ANALYZE;` per database. Note that ANALYZE, not VACUUM, is what rebuilds pg_statistic; plain VACUUM only refreshes pg_class.reltuples/relpages, which can mask the problem by partially unsticking the worst plans. On a PG 18 target, `vacuumdb --analyze-in-stages --missing-stats-only --all` gets usable estimates in place fastest. Do this while the target is still idle so the cost lands before cutover instead of during it.",
    severity: "warning",
    docsUrl: "https://www.postgresql.org/docs/current/sql-analyze.html",
  },
];

/**
 * All changes that apply when upgrading from `source` to `target`.
 * A change applies when source < introducedIn <= target.
 * Prerequisite checks are always included.
 */
export function changesForUpgrade(
  source: PgMajorVersion,
  target: PgMajorVersion,
): VersionChange[] {
  if (target <= source) return PREREQUISITE_CHECKS;
  const versionScoped = VERSION_CHANGES.filter(
    (c) => c.introducedIn > source && c.introducedIn <= target,
  );
  return [...PREREQUISITE_CHECKS, ...versionScoped];
}

export function changeCountByVersion(
  source: PgMajorVersion,
  target: PgMajorVersion,
): Record<PgMajorVersion, number> {
  const out = { 14: 0, 15: 0, 16: 0, 17: 0, 18: 0 } as Record<
    PgMajorVersion,
    number
  >;
  for (const c of changesForUpgrade(source, target)) {
    out[c.introducedIn] = (out[c.introducedIn] ?? 0) + 1;
  }
  return out;
}
