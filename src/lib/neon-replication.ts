/* ──────────────────────────────────────────────────────────────
   Logical replication setup against live Neon source + target.
   ────────────────────────────────────────────────────────────── */

import { Client } from "pg";
import type {
  LogicalReplicationCopyProgress,
  PublisherMonitorRow,
  ReplicationMonitor,
  ReplicationPreflight,
  ReplicationResourceInspection,
  ReplicationSetupStage,
  ReplicationSetupResult,
  ReplicationStatus,
  ReplicationTeardownResult,
  ReplicationTeardownStep,
  SubscriberMonitorRow,
  TableReplicationState,
} from "./types";
import { sanitizeDatabaseError } from "./neon-error-codes";

export const ADVISOR_PUBLICATION = "neon_advisor_pub" as const;
export const ADVISOR_SUBSCRIPTION = "neon_advisor_sub" as const;
const DEFAULT_PUB = ADVISOR_PUBLICATION;
const DEFAULT_SUB = ADVISOR_SUBSCRIPTION;

interface PostgresErrorLike {
  code?: string;
  message?: string;
  detail?: string;
}

export class ReplicationSetupError extends Error {
  readonly stage: ReplicationSetupStage;
  readonly resource: string | null;
  readonly code?: string;

  constructor(
    stage: ReplicationSetupStage,
    resource: string | null,
    error: unknown,
  ) {
    const postgresError =
      error && typeof error === "object"
        ? (error as PostgresErrorLike)
        : { message: String(error) };
    const safeDetail =
      postgresError.detail &&
      /^This operation is not supported for (?:unlogged|temporary) tables\.$/i.test(
        postgresError.detail,
      )
        ? postgresError.detail
        : null;
    super(
      sanitizeDatabaseError(
        [postgresError.message || "Unknown database error", safeDetail]
          .filter(Boolean)
          .join(" "),
      ),
    );
    this.name = "ReplicationSetupError";
    this.stage = stage;
    this.resource = resource;
    this.code = postgresError.code;
  }
}

function setupFailure(
  stage: ReplicationSetupStage,
  resource: string | null,
  error: unknown,
): ReplicationSetupError {
  return error instanceof ReplicationSetupError
    ? error
    : new ReplicationSetupError(stage, resource, error);
}

interface ReplicationTableRef {
  schema: string;
  table: string;
  qualifiedName: string;
  persistence: "p" | "u" | "t";
}

/** Returns `host` and unpooled (`-pooler` removed) connection string. */
function unpool(conn: string): string {
  // Logical replication requires a direct compute connection, not the pooler.
  return conn.replace(/-pooler/g, "");
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function tableName(table: Pick<ReplicationTableRef, "schema" | "table">): string {
  return `${table.schema}.${table.table}`;
}

async function resolveTableSelection(
  sourceConn: string,
  requestedTables?: string[],
  options: { allowUnlogged?: boolean } = {},
): Promise<ReplicationTableRef[] | null> {
  if (requestedTables === undefined) return null;
  const requested = [...new Set(requestedTables.map((table) => table.trim()))];
  if (requested.length === 0 || requested.some((table) => !table)) {
    throw new Error("Select at least one source table to replicate.");
  }

  const src = new Client({ connectionString: unpool(sourceConn) });
  await src.connect();
  try {
    const available = await src.query<{
      schema: string;
      table: string;
      persistence: "p" | "u" | "t";
    }>(`
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        c.relpersistence AS persistence
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY 1, 2
    `);
    const byName = new Map(
      available.rows.map((table) => [
        tableName(table),
        { ...table, qualifiedName: tableName(table) },
      ]),
    );
    const missing = requested.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Selected table${missing.length === 1 ? "" : "s"} not found on source: ${missing.join(", ")}`,
      );
    }
    const selected = requested.map((name) => byName.get(name)!);
    const unlogged = selected.filter((table) => table.persistence === "u");
    if (!options.allowUnlogged && unlogged.length > 0) {
      throw new Error(
        `Unlogged tables cannot be published because they do not write WAL: ${unlogged.map((table) => table.qualifiedName).join(", ")}. Deselect them or convert them to LOGGED before retrying.`,
      );
    }
    return selected;
  } finally {
    await src.end();
  }
}

/* ── Preflight ─────────────────────────────────────────────── */

export async function preflight(
  sourceConn: string,
  targetConn: string,
  requestedTables?: string[],
): Promise<
  Omit<
    ReplicationPreflight,
    "resources" | "recoveryRequired" | "resumeMonitoring"
  >
> {
  const selectedTables = await resolveTableSelection(
    sourceConn,
    requestedTables,
    { allowUnlogged: true },
  );
  const selectedTableNames = selectedTables
    ? new Set(selectedTables.map((table) => table.qualifiedName))
    : null;
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const srcVersion = (
      await src.query<{ num: string; wal: string; user: string }>(
        "SELECT current_setting('server_version_num') AS num, current_setting('wal_level') AS wal, current_user AS user",
      )
    ).rows[0];
    const tgtVersion = (
      await tgt.query<{ num: string }>(
        "SELECT current_setting('server_version_num') AS num",
      )
    ).rows[0];

    const srcTables = await src.query<{
      schema: string;
      table: string;
      persistence: "p" | "u" | "t";
    }>(`
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        c.relpersistence AS persistence
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY 1, 2
    `);
    const noPK = await src.query<{
      schema: string;
      table: string;
      replica_identity: "d" | "n" | "f" | "i";
    }>(`
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        c.relreplident AS replica_identity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary
        )
      ORDER BY 1, 2
    `);
    const generated = await src.query<{
      schema: string;
      table: string;
      column: string;
      generation_kind: "s" | "v";
    }>(`
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        a.attname AS column,
        a.attgenerated AS generation_kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attgenerated <> ''
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY 1, 2, a.attnum
    `);
    const repRole = await src.query<{
      rolreplication: boolean;
      rolname: string;
      neon_superuser_member: boolean;
    }>(`
      SELECT
        role.rolname,
        role.rolreplication,
        EXISTS (
          SELECT 1
          FROM pg_roles neon_role
          WHERE neon_role.rolname = 'neon_superuser'
            AND pg_has_role(current_user, neon_role.oid, 'member')
        ) AS neon_superuser_member
      FROM pg_roles role
      WHERE role.rolname = current_user
    `);

    const tgtTables = await tgt.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
    `);
    const existingSub = await tgt.query<{ subname: string }>(
      "SELECT subname FROM pg_subscription WHERE subname = $1",
      [DEFAULT_SUB],
    );

    const sourceTables = selectedTableNames
      ? srcTables.rows.filter((table) =>
          selectedTableNames.has(tableName(table)),
        )
      : srcTables.rows;
    const sourceUnloggedTables = sourceTables.filter(
      (table) => table.persistence === "u",
    );
    const replicationSourceTables = sourceTables.filter(
      (table) => table.persistence === "p",
    );
    const replicationTableNames = new Set(
      replicationSourceTables.map(tableName),
    );
    const sourceTablesWithoutPK = selectedTableNames
      ? noPK.rows.filter((table) =>
          replicationTableNames.has(tableName(table)),
        )
      : noPK.rows.filter((table) =>
          replicationTableNames.has(tableName(table)),
        );
    const sourceGeneratedColumns = selectedTableNames
      ? generated.rows.filter((column) =>
          replicationTableNames.has(tableName(column)),
        )
      : generated.rows.filter((column) =>
          replicationTableNames.has(tableName(column)),
        );
    const walLevel = srcVersion.wal;
    const logicalEnabled = walLevel === "logical";
    const roleHasReplication = Boolean(
      repRole.rows[0]?.rolreplication ||
        repRole.rows[0]?.neon_superuser_member,
    );
    const tableCount = sourceTables.length;
    const tables = sourceTables.map(tableName);
    const replicationTables = replicationSourceTables.map(tableName);
    const unloggedTables = sourceUnloggedTables.map(tableName);
    const tablesWithoutPK = sourceTablesWithoutPK.map(tableName);
    const tablesWithoutReplicaIdentity = sourceTablesWithoutPK
      .filter(
        (table) =>
          table.replica_identity !== "f" && table.replica_identity !== "i",
      )
      .map(tableName);
    const tablesWithReplicaIdentityFull = sourceTablesWithoutPK
      .filter((table) => table.replica_identity === "f")
      .map(tableName);
    const generatedColumns = sourceGeneratedColumns.map((column) => ({
      table: tableName(column),
      column: column.column,
      kind:
        column.generation_kind === "v"
          ? ("virtual" as const)
          : ("stored" as const),
    }));
    const targetTables = new Set(
      tgtTables.rows.map((r) => `${r.schema}.${r.table}`),
    );
    const targetSchemaTableCount = replicationTables.filter((table) =>
      targetTables.has(table),
    ).length;
    const targetSchemaLoaded =
      replicationTables.length > 0 &&
      replicationTables.every((table) => targetTables.has(table));

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!logicalEnabled) {
      blockers.push(
        `Source wal_level is '${walLevel}'. Enable logical replication on the source Neon project (irreversible).`,
      );
    }
    if (!roleHasReplication) {
      blockers.push(
        `Connection role '${srcVersion.user}' does not have REPLICATION privilege.`,
      );
    }
    if (tableCount === 0) {
      blockers.push("No user tables found on source.");
    }
    if (!targetSchemaLoaded && replicationTables.length > 0) {
      warnings.push(
        `Target schema has ${targetSchemaTableCount}/${replicationTables.length} tables, schema copy will run automatically.`,
      );
    }
    if (unloggedTables.length > 0) {
      const message = `Unlogged tables cannot be published because they do not write WAL: ${unloggedTables.join(", ")}. Recreate them empty on the target, or convert them to LOGGED if their rows must migrate.`;
      if (selectedTableNames) {
        blockers.push(message);
      } else {
        warnings.push(`Excluded from logical replication. ${message}`);
      }
    }
    if (tablesWithoutReplicaIdentity.length > 0) {
      warnings.push(
        `${tablesWithoutReplicaIdentity.length} tables without PRIMARY KEY or usable replica identity; updates/deletes won't replicate: ${tablesWithoutReplicaIdentity.slice(0, 5).join(", ")}${tablesWithoutReplicaIdentity.length > 5 ? "…" : ""}`,
      );
    }
    if (generatedColumns.length > 0) {
      warnings.push(
        `The current publication does not transmit generated values. Schema copy will recreate these expressions so the target recomputes them: ${generatedColumns.map(({ table, column }) => `${table}.${column}`).join(", ")}`,
      );
    }
    if (existingSub.rows.length > 0) {
      warnings.push(
        `Subscription '${DEFAULT_SUB}' already exists on target. Setup will reuse it or fail.`,
      );
    }

    return {
      source: {
        pgVersion: Math.floor(parseInt(srcVersion.num, 10) / 10000),
        walLevel,
        logicalReplicationEnabled: logicalEnabled,
        tableCount,
        tables,
        tablesWithoutPK,
        tablesWithoutReplicaIdentity,
        tablesWithReplicaIdentityFull,
        generatedColumns,
        unloggedTables,
        roleHasReplication,
        rolname: srcVersion.user,
      },
      target: {
        pgVersion: Math.floor(parseInt(tgtVersion.num, 10) / 10000),
        schemaLoaded: targetSchemaLoaded,
        schemaTableCount: targetSchemaTableCount,
        existingSubscription: existingSub.rows[0]?.subname ?? null,
      },
      ok: blockers.length === 0,
      blockers,
      warnings,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Setup ─────────────────────────────────────────────────── */

interface SchemaCopyReport {
  extensionsCreated: string[];
  extensionsFailed: { name: string; error: string; code?: string }[];
  typesCreated: string[];
  typesSkipped: string[];
  typesFailed: { name: string; error: string; ddl: string; code?: string }[];
  tablesCreated: string[];
  tablesSkipped: string[];
  tablesFailed: { name: string; error: string; ddl: string; code?: string }[];
  indexesCreated: number;
  indexesFailed: { name: string; error: string }[];
}

interface SequenceColumnReference {
  schema: string;
  table: string;
  column: string;
}

interface SourceSequenceDefinition {
  schema: string;
  name: string;
  data_type: "smallint" | "integer" | "bigint";
  start_value: string;
  increment_by: string;
  min_value: string;
  max_value: string;
  cache_size: string;
  cycles: boolean;
  owner_schema: string | null;
  owner_table: string | null;
  owner_column: string | null;
  dependency_type: "a" | "i" | null;
  default_references: SequenceColumnReference[];
}

function sequenceInteger(value: string, field: string): string {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid ${field} returned by PostgreSQL: ${value}`);
  }
  return value;
}

function qualifiedIdentifier(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

function sequenceOptions(sequence: SourceSequenceDefinition): string {
  const increment = sequenceInteger(sequence.increment_by, "sequence increment");
  const min = sequenceInteger(sequence.min_value, "sequence minimum");
  const max = sequenceInteger(sequence.max_value, "sequence maximum");
  const start = sequenceInteger(sequence.start_value, "sequence start");
  const cache = sequenceInteger(sequence.cache_size, "sequence cache");
  return [
    `INCREMENT BY ${increment}`,
    `MINVALUE ${min}`,
    `MAXVALUE ${max}`,
    `START WITH ${start}`,
    `CACHE ${cache}`,
    sequence.cycles ? "CYCLE" : "NO CYCLE",
  ].join(" ");
}

type PostgreSQLTypeKind = "b" | "c" | "d" | "e" | "m" | "p" | "r";

interface SourceTypeCatalogRow {
  oid: string;
  schema: string;
  type: string;
  kind: PostgreSQLTypeKind;
  category: string;
  is_defined: boolean;
  relation_kind: string | null;
  element_oid: string;
  array_oid: string;
  base_oid: string;
  extension_name: string | null;
}

interface SourceDomainDefinition {
  oid: string;
  base_type: string;
  not_null: boolean;
  default_expr: string | null;
  collation_schema: string | null;
  collation_name: string | null;
  collation_extension: string | null;
  constraints: { name: string; definition: string }[];
}

interface SourceCompositeAttribute {
  type_oid: string;
  position: number;
  name: string;
  formatted_type: string;
  attribute_type_oid: string;
  collation_schema: string | null;
  collation_name: string | null;
  collation_extension: string | null;
}

interface SourceRangeDefinition {
  type_oid: string;
  subtype_oid: string;
  subtype: string;
  opclass_schema: string;
  opclass_name: string;
  opclass_extension: string | null;
  collation_schema: string | null;
  collation_name: string | null;
  collation_extension: string | null;
  canonical_schema: string | null;
  canonical_name: string | null;
  canonical_extension: string | null;
  subdiff_schema: string | null;
  subdiff_name: string | null;
  subdiff_extension: string | null;
  multirange_oid: string;
  multirange_schema: string;
  multirange_name: string;
}

interface CustomTypeDefinition {
  oid: string;
  schema: string;
  type: string;
  requiredSchemas: string[];
  dependencies: string[];
  ddl: string;
}

interface CustomTypePlan {
  definitions: CustomTypeDefinition[];
  skipped: string[];
  failures: { name: string; error: string; ddl: string }[];
}

function isSystemSchema(schema: string): boolean {
  return schema === "information_schema" || schema.startsWith("pg_");
}

function sourceTypeName(
  type: Pick<SourceTypeCatalogRow, "schema" | "type">,
): string {
  return `${type.schema}.${type.type}`;
}

function supportingObjectIsPortable(
  schema: string | null,
  extensionName: string | null,
): boolean {
  return schema === null || schema === "pg_catalog" || extensionName !== null;
}

function isGeneratedArrayType(
  type: SourceTypeCatalogRow,
  typesByOid: Map<string, SourceTypeCatalogRow>,
): boolean {
  const elementType = typesByOid.get(type.element_oid);
  return (
    type.kind === "b" &&
    type.element_oid !== "0" &&
    elementType?.array_oid === type.oid
  );
}

async function planCustomTypes(
  source: Client,
  target: Client,
  selectedTableNames: Set<string> | null,
): Promise<CustomTypePlan> {
  const catalog = await source.query<SourceTypeCatalogRow>(`
    SELECT
      type_catalog.oid::text AS oid,
      type_namespace.nspname AS "schema",
      type_catalog.typname AS "type",
      type_catalog.typtype AS kind,
      type_catalog.typcategory AS category,
      type_catalog.typisdefined AS is_defined,
      relation_catalog.relkind AS relation_kind,
      type_catalog.typelem::text AS element_oid,
      type_catalog.typarray::text AS array_oid,
      type_catalog.typbasetype::text AS base_oid,
      owned_extension.extname AS extension_name
    FROM pg_type type_catalog
    JOIN pg_namespace type_namespace
      ON type_namespace.oid = type_catalog.typnamespace
    LEFT JOIN pg_class relation_catalog
      ON relation_catalog.oid = type_catalog.typrelid
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_type'::regclass
        AND extension_dependency.objid = type_catalog.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) owned_extension ON true
  `);
  const typesByOid = new Map(catalog.rows.map((type) => [type.oid, type]));

  const seeds = await source.query<{ oid: string }>(
    `SELECT DISTINCT attribute_catalog.atttypid::text AS oid
     FROM pg_attribute attribute_catalog
     JOIN pg_class table_catalog
       ON table_catalog.oid = attribute_catalog.attrelid
     JOIN pg_namespace table_namespace
       ON table_namespace.oid = table_catalog.relnamespace
     WHERE table_catalog.relkind = 'r'
       AND attribute_catalog.attnum > 0
       AND NOT attribute_catalog.attisdropped
       AND table_namespace.nspname <> 'information_schema'
       AND table_namespace.nspname !~ '^pg_'
       AND NOT EXISTS (
         SELECT 1
         FROM pg_depend extension_dependency
         WHERE extension_dependency.classid = 'pg_class'::regclass
           AND extension_dependency.objid = table_catalog.oid
           AND extension_dependency.deptype = 'e'
       )
       AND (
         $1::text[] IS NULL
         OR (
           table_namespace.nspname || '.' || table_catalog.relname
         ) = ANY($1::text[])
       )
     ORDER BY 1`,
    [selectedTableNames ? [...selectedTableNames] : null],
  );

  const enumRows = await source.query<{ oid: string; labels: string[] }>(`
    SELECT
      type_catalog.oid::text AS oid,
      COALESCE(
        json_agg(enum_catalog.enumlabel::text ORDER BY enum_catalog.enumsortorder)
          FILTER (WHERE enum_catalog.enumlabel IS NOT NULL),
        '[]'::json
      ) AS labels
    FROM pg_type type_catalog
    JOIN pg_namespace type_namespace
      ON type_namespace.oid = type_catalog.typnamespace
    LEFT JOIN pg_enum enum_catalog
      ON enum_catalog.enumtypid = type_catalog.oid
    WHERE type_catalog.typtype = 'e'
      AND type_namespace.nspname <> 'information_schema'
      AND type_namespace.nspname !~ '^pg_'
    GROUP BY type_catalog.oid
  `);
  const enumLabelsByOid = new Map(
    enumRows.rows.map((type) => [type.oid, type.labels]),
  );

  const domainRows = await source.query<SourceDomainDefinition>(`
    SELECT
      type_catalog.oid::text AS oid,
      pg_catalog.format_type(
        type_catalog.typbasetype,
        type_catalog.typtypmod
      ) AS base_type,
      type_catalog.typnotnull AS not_null,
      pg_get_expr(type_catalog.typdefaultbin, 0) AS default_expr,
      collation_namespace.nspname AS collation_schema,
      collation_catalog.collname AS collation_name,
      collation_extension.extname AS collation_extension,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'name', domain_constraint.conname,
              'definition', pg_get_constraintdef(domain_constraint.oid, true)
            )
            ORDER BY domain_constraint.conname
          )
          FROM pg_constraint domain_constraint
          WHERE domain_constraint.contypid = type_catalog.oid
            AND domain_constraint.contype = 'c'
        ),
        '[]'::json
      ) AS constraints
    FROM pg_type type_catalog
    JOIN pg_namespace type_namespace
      ON type_namespace.oid = type_catalog.typnamespace
    LEFT JOIN pg_collation collation_catalog
      ON collation_catalog.oid = type_catalog.typcollation
    LEFT JOIN pg_namespace collation_namespace
      ON collation_namespace.oid = collation_catalog.collnamespace
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_collation'::regclass
        AND extension_dependency.objid = collation_catalog.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) collation_extension ON true
    WHERE type_catalog.typtype = 'd'
      AND type_namespace.nspname <> 'information_schema'
      AND type_namespace.nspname !~ '^pg_'
  `);
  const domainsByOid = new Map(
    domainRows.rows.map((type) => [type.oid, type]),
  );

  const compositeRows = await source.query<SourceCompositeAttribute>(`
    SELECT
      type_catalog.oid::text AS type_oid,
      attribute_catalog.attnum AS position,
      attribute_catalog.attname AS name,
      pg_catalog.format_type(
        attribute_catalog.atttypid,
        attribute_catalog.atttypmod
      ) AS formatted_type,
      attribute_catalog.atttypid::text AS attribute_type_oid,
      collation_namespace.nspname AS collation_schema,
      collation_catalog.collname AS collation_name,
      collation_extension.extname AS collation_extension
    FROM pg_type type_catalog
    JOIN pg_namespace type_namespace
      ON type_namespace.oid = type_catalog.typnamespace
    JOIN pg_class relation_catalog
      ON relation_catalog.oid = type_catalog.typrelid
    JOIN pg_attribute attribute_catalog
      ON attribute_catalog.attrelid = type_catalog.typrelid
    LEFT JOIN pg_collation collation_catalog
      ON collation_catalog.oid = attribute_catalog.attcollation
    LEFT JOIN pg_namespace collation_namespace
      ON collation_namespace.oid = collation_catalog.collnamespace
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_collation'::regclass
        AND extension_dependency.objid = collation_catalog.oid
        AND extension_dependency.objsubid = 0
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) collation_extension ON true
    WHERE type_catalog.typtype = 'c'
      AND relation_catalog.relkind = 'c'
      AND attribute_catalog.attnum > 0
      AND NOT attribute_catalog.attisdropped
      AND type_namespace.nspname <> 'information_schema'
      AND type_namespace.nspname !~ '^pg_'
    ORDER BY type_catalog.oid, attribute_catalog.attnum
  `);
  const compositeAttributesByOid = new Map<
    string,
    SourceCompositeAttribute[]
  >();
  for (const attribute of compositeRows.rows) {
    const attributes =
      compositeAttributesByOid.get(attribute.type_oid) ?? [];
    attributes.push(attribute);
    compositeAttributesByOid.set(attribute.type_oid, attributes);
  }

  const rangeRows = await source.query<SourceRangeDefinition>(`
    SELECT
      range_catalog.rngtypid::text AS type_oid,
      range_catalog.rngsubtype::text AS subtype_oid,
      pg_catalog.format_type(range_catalog.rngsubtype, NULL) AS subtype,
      opclass_namespace.nspname AS opclass_schema,
      opclass_catalog.opcname AS opclass_name,
      opclass_extension.extname AS opclass_extension,
      collation_namespace.nspname AS collation_schema,
      collation_catalog.collname AS collation_name,
      collation_extension.extname AS collation_extension,
      canonical_namespace.nspname AS canonical_schema,
      canonical_function.proname AS canonical_name,
      canonical_extension.extname AS canonical_extension,
      subdiff_namespace.nspname AS subdiff_schema,
      subdiff_function.proname AS subdiff_name,
      subdiff_extension.extname AS subdiff_extension,
      range_catalog.rngmultitypid::text AS multirange_oid,
      multirange_namespace.nspname AS multirange_schema,
      multirange_type.typname AS multirange_name
    FROM pg_range range_catalog
    JOIN pg_type range_type
      ON range_type.oid = range_catalog.rngtypid
    JOIN pg_namespace range_namespace
      ON range_namespace.oid = range_type.typnamespace
    JOIN pg_type multirange_type
      ON multirange_type.oid = range_catalog.rngmultitypid
    JOIN pg_namespace multirange_namespace
      ON multirange_namespace.oid = multirange_type.typnamespace
    JOIN pg_opclass opclass_catalog
      ON opclass_catalog.oid = range_catalog.rngsubopc
    JOIN pg_namespace opclass_namespace
      ON opclass_namespace.oid = opclass_catalog.opcnamespace
    LEFT JOIN pg_collation collation_catalog
      ON collation_catalog.oid = range_catalog.rngcollation
    LEFT JOIN pg_namespace collation_namespace
      ON collation_namespace.oid = collation_catalog.collnamespace
    LEFT JOIN pg_proc canonical_function
      ON canonical_function.oid = range_catalog.rngcanonical
    LEFT JOIN pg_namespace canonical_namespace
      ON canonical_namespace.oid = canonical_function.pronamespace
    LEFT JOIN pg_proc subdiff_function
      ON subdiff_function.oid = range_catalog.rngsubdiff
    LEFT JOIN pg_namespace subdiff_namespace
      ON subdiff_namespace.oid = subdiff_function.pronamespace
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_opclass'::regclass
        AND extension_dependency.objid = opclass_catalog.oid
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) opclass_extension ON true
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_collation'::regclass
        AND extension_dependency.objid = collation_catalog.oid
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) collation_extension ON true
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.objid = canonical_function.oid
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) canonical_extension ON true
    LEFT JOIN LATERAL (
      SELECT extension_catalog.extname
      FROM pg_depend extension_dependency
      JOIN pg_extension extension_catalog
        ON extension_catalog.oid = extension_dependency.refobjid
      WHERE extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.objid = subdiff_function.oid
        AND extension_dependency.refclassid = 'pg_extension'::regclass
        AND extension_dependency.deptype = 'e'
      LIMIT 1
    ) subdiff_extension ON true
    WHERE range_namespace.nspname <> 'information_schema'
      AND range_namespace.nspname !~ '^pg_'
  `);
  const rangesByOid = new Map(
    rangeRows.rows.map((range) => [range.type_oid, range]),
  );
  const rangeOidByMultirangeOid = new Map(
    rangeRows.rows.map((range) => [range.multirange_oid, range.type_oid]),
  );

  const existingTypes = new Set(
    (
      await target.query<{ schema: string; type: string }>(`
        SELECT n.nspname AS schema, t.typname AS type
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
      `)
    ).rows.map(({ schema, type }) => `${schema}.${type}`),
  );

  const required = new Set<string>();
  const visited = new Set<string>();
  const skipped = new Set<string>();
  const failuresByOid = new Map<
    string,
    { name: string; error: string; ddl: string }
  >();

  const rawDependencies = (type: SourceTypeCatalogRow): string[] => {
    if (type.kind === "d") return type.base_oid === "0" ? [] : [type.base_oid];
    if (type.kind === "c") {
      return (compositeAttributesByOid.get(type.oid) ?? []).map(
        (attribute) => attribute.attribute_type_oid,
      );
    }
    if (type.kind === "r") {
      const range = rangesByOid.get(type.oid);
      return range ? [range.subtype_oid] : [];
    }
    return [];
  };

  const failType = (type: SourceTypeCatalogRow, error: string) => {
    required.delete(type.oid);
    failuresByOid.set(type.oid, {
      name: sourceTypeName(type),
      error,
      ddl: `CREATE TYPE ${qualifiedIdentifier(type.schema, type.type)} (...)`,
    });
  };

  const requireType = (oid: string) => {
    if (oid === "0" || visited.has(oid)) return;
    visited.add(oid);
    const type = typesByOid.get(oid);
    if (!type) {
      failuresByOid.set(oid, {
        name: `type OID ${oid}`,
        error: `PostgreSQL returned no catalog metadata for required type OID ${oid}.`,
        ddl: `-- unresolved type OID ${oid}`,
      });
      return;
    }
    const qualifiedName = sourceTypeName(type);
    if (isSystemSchema(type.schema)) return;
    if (isGeneratedArrayType(type, typesByOid)) {
      requireType(type.element_oid);
      return;
    }
    if (existingTypes.has(qualifiedName)) {
      skipped.add(qualifiedName);
      return;
    }
    if (type.extension_name) {
      failType(
        type,
        `Extension ${type.extension_name} owns this type, but installing that extension did not create it on the target.`,
      );
      return;
    }
    if (!type.is_defined) {
      failType(
        type,
        "This is an undefined shell type. Complete its definition on the source or create the matching type on the target.",
      );
      return;
    }
    if (type.kind === "m") {
      const rangeOid = rangeOidByMultirangeOid.get(type.oid);
      if (!rangeOid) {
        failType(type, "No owning range type was found for this multirange.");
        return;
      }
      const rangeType = typesByOid.get(rangeOid);
      if (
        rangeType &&
        existingTypes.has(sourceTypeName(rangeType)) &&
        !existingTypes.has(qualifiedName)
      ) {
        failType(
          type,
          `The target already has range ${sourceTypeName(rangeType)}, but it does not provide the source multirange name ${qualifiedName}. Recreate the range with the matching MULTIRANGE_TYPE_NAME.`,
        );
        return;
      }
      requireType(rangeOid);
      return;
    }
    if (type.kind === "b") {
      failType(
        type,
        "User-defined base types require their input/output functions or native extension library and cannot be recreated safely. Install the owning extension or create the matching type on the target.",
      );
      return;
    }
    if (type.kind === "p") {
      failType(
        type,
        "User-defined pseudo-types cannot be recreated by the migration assistant. Create the matching type on the target.",
      );
      return;
    }
    if (type.kind === "c" && type.relation_kind !== "c") {
      failType(
        type,
        "This is a table row type rather than a standalone composite type. Create its defining table on the target before retrying.",
      );
      return;
    }
    if (!["c", "d", "e", "r"].includes(type.kind)) {
      failType(
        type,
        `PostgreSQL type kind ${type.kind} is not supported by schema copy.`,
      );
      return;
    }

    if (type.kind === "e") {
      const labels = enumLabelsByOid.get(type.oid);
      if (!Array.isArray(labels)) {
        failType(type, "PostgreSQL did not return enum labels as an array.");
        return;
      }
    } else if (type.kind === "d") {
      const domain = domainsByOid.get(type.oid);
      if (!domain) {
        failType(type, "PostgreSQL returned no domain definition.");
        return;
      }
      if (
        !supportingObjectIsPortable(
          domain.collation_schema,
          domain.collation_extension,
        )
      ) {
        failType(
          type,
          `Domain collation ${domain.collation_schema}.${domain.collation_name} is not built in or extension-owned. Create the matching domain on the target before retrying.`,
        );
        return;
      }
    } else if (type.kind === "c") {
      const unsupportedCollation = (
        compositeAttributesByOid.get(type.oid) ?? []
      ).find(
        (attribute) =>
          !supportingObjectIsPortable(
            attribute.collation_schema,
            attribute.collation_extension,
          ),
      );
      if (unsupportedCollation) {
        failType(
          type,
          `Composite attribute ${unsupportedCollation.name} uses collation ${unsupportedCollation.collation_schema}.${unsupportedCollation.collation_name}, which is not built in or extension-owned. Create the matching composite type on the target before retrying.`,
        );
        return;
      }
    } else if (type.kind === "r") {
      const range = rangesByOid.get(type.oid);
      if (!range) {
        failType(type, "PostgreSQL returned no pg_range definition.");
        return;
      }
      const unsupportedObject = [
        {
          label: "operator class",
          schema: range.opclass_schema,
          name: range.opclass_name,
          extension: range.opclass_extension,
        },
        {
          label: "collation",
          schema: range.collation_schema,
          name: range.collation_name,
          extension: range.collation_extension,
        },
        {
          label: "canonical function",
          schema: range.canonical_schema,
          name: range.canonical_name,
          extension: range.canonical_extension,
        },
        {
          label: "subtype difference function",
          schema: range.subdiff_schema,
          name: range.subdiff_name,
          extension: range.subdiff_extension,
        },
      ].find(
        (object) =>
          !supportingObjectIsPortable(object.schema, object.extension),
      );
      if (unsupportedObject) {
        failType(
          type,
          `Range ${unsupportedObject.label} ${unsupportedObject.schema}.${unsupportedObject.name} is not built in or extension-owned. Create the supporting object and matching range on the target before retrying.`,
        );
        return;
      }
    }

    required.add(type.oid);
    for (const dependency of rawDependencies(type)) requireType(dependency);
  };

  for (const seed of seeds.rows) requireType(seed.oid);

  const unsupportedDependency = (
    oid: string,
    seen = new Set<string>(),
  ): string | null => {
    if (oid === "0" || seen.has(oid)) return null;
    seen.add(oid);
    if (failuresByOid.has(oid)) return oid;
    const type = typesByOid.get(oid);
    if (!type) return oid;
    if (isSystemSchema(type.schema)) return null;
    if (isGeneratedArrayType(type, typesByOid)) {
      return unsupportedDependency(type.element_oid, seen);
    }
    if (existingTypes.has(sourceTypeName(type))) return null;
    if (type.kind === "m") {
      const rangeOid = rangeOidByMultirangeOid.get(type.oid);
      return rangeOid ? unsupportedDependency(rangeOid, seen) : type.oid;
    }
    return null;
  };

  let dependenciesChanged = true;
  while (dependenciesChanged) {
    dependenciesChanged = false;
    for (const oid of [...required]) {
      const type = typesByOid.get(oid);
      if (!type) continue;
      const unavailable = rawDependencies(type)
        .map((dependency) => unsupportedDependency(dependency))
        .find((dependency): dependency is string => dependency !== null);
      if (!unavailable) continue;
      const failedDependency = typesByOid.get(unavailable);
      failType(
        type,
        `Depends on unsupported custom type ${failedDependency ? sourceTypeName(failedDependency) : unavailable}.`,
      );
      dependenciesChanged = true;
    }
  }

  const explicitDependencies = (
    oid: string,
    result = new Set<string>(),
    seen = new Set<string>(),
  ): Set<string> => {
    if (oid === "0" || seen.has(oid)) return result;
    seen.add(oid);
    if (required.has(oid)) {
      result.add(oid);
      return result;
    }
    const type = typesByOid.get(oid);
    if (!type) return result;
    if (isGeneratedArrayType(type, typesByOid)) {
      return explicitDependencies(type.element_oid, result, seen);
    }
    if (type.kind === "m") {
      const rangeOid = rangeOidByMultirangeOid.get(type.oid);
      if (rangeOid) explicitDependencies(rangeOid, result, seen);
    }
    return result;
  };

  const definitionsByOid = new Map<string, CustomTypeDefinition>();
  for (const oid of required) {
    const type = typesByOid.get(oid);
    if (!type) continue;
    const dependencies = [
      ...new Set(
        rawDependencies(type).flatMap((dependency) => [
          ...explicitDependencies(dependency),
        ]),
      ),
    ].filter((dependency) => dependency !== oid);
    let ddl: string;
    if (type.kind === "e") {
      const labels = enumLabelsByOid.get(type.oid) ?? [];
      ddl = `CREATE TYPE ${qualifiedIdentifier(type.schema, type.type)} AS ENUM (${labels.map(quoteLiteral).join(", ")})`;
    } else if (type.kind === "d") {
      const domain = domainsByOid.get(type.oid)!;
      const collation =
        domain.collation_schema && domain.collation_name
          ? ` COLLATE ${qualifiedIdentifier(domain.collation_schema, domain.collation_name)}`
          : "";
      const defaultClause = domain.default_expr
        ? ` DEFAULT ${domain.default_expr}`
        : "";
      const notNullClause = domain.not_null ? " NOT NULL" : "";
      const constraints = Array.isArray(domain.constraints)
        ? domain.constraints
            .map(
              (constraint) =>
                ` CONSTRAINT ${quoteIdent(constraint.name)} ${constraint.definition}`,
            )
            .join("")
        : "";
      ddl =
        `CREATE DOMAIN ${qualifiedIdentifier(type.schema, type.type)} ` +
        `AS ${domain.base_type}${collation}${defaultClause}${notNullClause}${constraints}`;
    } else if (type.kind === "c") {
      const attributes = compositeAttributesByOid.get(type.oid) ?? [];
      const attributeDefinitions = attributes.map((attribute) => {
        const collation =
          attribute.collation_schema && attribute.collation_name
            ? ` COLLATE ${qualifiedIdentifier(attribute.collation_schema, attribute.collation_name)}`
            : "";
        return `${quoteIdent(attribute.name)} ${attribute.formatted_type}${collation}`;
      });
      ddl =
        `CREATE TYPE ${qualifiedIdentifier(type.schema, type.type)} AS (` +
        `${attributeDefinitions.join(", ")})`;
    } else {
      const range = rangesByOid.get(type.oid)!;
      const options = [
        `SUBTYPE = ${range.subtype}`,
        `SUBTYPE_OPCLASS = ${qualifiedIdentifier(range.opclass_schema, range.opclass_name)}`,
        ...(range.collation_schema && range.collation_name
          ? [
              `COLLATION = ${qualifiedIdentifier(range.collation_schema, range.collation_name)}`,
            ]
          : []),
        ...(range.canonical_schema && range.canonical_name
          ? [
              `CANONICAL = ${qualifiedIdentifier(range.canonical_schema, range.canonical_name)}`,
            ]
          : []),
        ...(range.subdiff_schema && range.subdiff_name
          ? [
              `SUBTYPE_DIFF = ${qualifiedIdentifier(range.subdiff_schema, range.subdiff_name)}`,
            ]
          : []),
        `MULTIRANGE_TYPE_NAME = ${qualifiedIdentifier(range.multirange_schema, range.multirange_name)}`,
      ];
      ddl =
        `CREATE TYPE ${qualifiedIdentifier(type.schema, type.type)} ` +
        `AS RANGE (${options.join(", ")})`;
    }
    definitionsByOid.set(oid, {
      oid,
      schema: type.schema,
      type: type.type,
      requiredSchemas:
        type.kind === "r"
          ? [
              type.schema,
              rangesByOid.get(type.oid)!.multirange_schema,
            ]
          : [type.schema],
      dependencies,
      ddl,
    });
  }

  const remaining = new Map(definitionsByOid);
  const ordered: CustomTypeDefinition[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((definition) =>
        definition.dependencies.every(
          (dependency) => !remaining.has(dependency),
        ),
      )
      .sort((a, b) =>
        `${a.schema}.${a.type}`.localeCompare(`${b.schema}.${b.type}`),
      );
    if (ready.length === 0) {
      for (const definition of remaining.values()) {
        const type = typesByOid.get(definition.oid)!;
        failType(
          type,
          `Custom type dependency cycle detected among ${[...remaining.values()]
            .map((item) => `${item.schema}.${item.type}`)
            .join(", ")}.`,
        );
      }
      break;
    }
    for (const definition of ready) {
      ordered.push(definition);
      remaining.delete(definition.oid);
    }
  }

  return {
    definitions: ordered,
    skipped: [...skipped].sort(),
    failures: [...failuresByOid.values()],
  };
}

/** Copy schema from source to target via pg_catalog introspection.
    Uses pg_catalog.format_type() (proper SQL types like "character varying(50)",
    "timestamp with time zone[]") so the DDL round-trips correctly across
    PG14 → PG18. Returns a detailed report so failures surface to the UI.
    For absolute pg_dump fidelity, run `pg_dump --schema-only` out of band. */
export async function copySchemaIfNeeded(
  sourceConn: string,
  targetConn: string,
  selectedTables: ReplicationTableRef[] | null,
): Promise<SchemaCopyReport> {
  const report: SchemaCopyReport = {
    extensionsCreated: [],
    extensionsFailed: [],
    typesCreated: [],
    typesSkipped: [],
    typesFailed: [],
    tablesCreated: [],
    tablesSkipped: [],
    tablesFailed: [],
    indexesCreated: 0,
    indexesFailed: [],
  };

  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    // Force catalog deparsers such as format_type() and pg_get_expr() to
    // schema-qualify user-defined dependencies.
    await src.query("SET search_path TO pg_catalog");

    const selectedTableNames = selectedTables
      ? new Set(selectedTables.map((table) => table.qualifiedName))
      : null;
    const selectedSchemas = selectedTables
      ? [...new Set(selectedTables.map((table) => table.schema))]
      : null;

    // 1. User-defined schemas. Logical replication is database-wide, not
    //    limited to `public`, so preserve every non-system schema containing
    //    a user table or sequence.
    const schemas = selectedSchemas
      ? selectedSchemas.map((schema) => ({ schema }))
      : (
          await src.query<{ schema: string }>(`
            SELECT DISTINCT n.nspname AS schema
            FROM pg_namespace n
            JOIN pg_class c ON c.relnamespace = n.oid
            WHERE c.relkind IN ('r', 'S')
              AND n.nspname <> 'information_schema'
              AND n.nspname !~ '^pg_'
              AND NOT EXISTS (
                SELECT 1 FROM pg_depend d
                WHERE d.objid = c.oid AND d.deptype = 'e'
              )
            ORDER BY 1
          `)
        ).rows;
    for (const { schema } of schemas) {
      try {
        await tgt.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      } catch (err) {
        report.tablesFailed.push({
          name: `${schema} (schema)`,
          error: err instanceof Error ? err.message : String(err),
          ddl: `CREATE SCHEMA IF NOT EXISTS "${schema}"`,
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
      }
    }

    // 2. Extensions. Preserve the source installation schema so extension
    //    types and functions resolve the same way when custom types are copied.
    const exts = await src.query<{ extname: string; schema: string }>(`
      SELECT e.extname, n.nspname AS schema
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname <> 'plpgsql'
      ORDER BY e.extname
    `);
    for (const e of exts.rows) {
      try {
        await tgt.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(e.schema)}`);
        const installed = await tgt.query<{ schema: string }>(
          `SELECT n.nspname AS schema
           FROM pg_extension x
           JOIN pg_namespace n ON n.oid = x.extnamespace
           WHERE x.extname = $1`,
          [e.extname],
        );
        if (
          installed.rows[0] &&
          installed.rows[0].schema !== e.schema
        ) {
          throw new Error(
            `Extension is already installed in schema ${installed.rows[0].schema}; source uses ${e.schema}.`,
          );
        }
        if (installed.rows.length === 0) {
          await tgt.query(
            `CREATE EXTENSION ${quoteIdent(e.extname)} WITH SCHEMA ${quoteIdent(e.schema)}`,
          );
        }
        report.extensionsCreated.push(e.extname);
      } catch (err) {
        report.extensionsFailed.push({
          name: e.extname,
          error: err instanceof Error ? err.message : String(err),
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
      }
    }

    // 3. Recreate the complete custom-type dependency closure required by the
    //    selected tables. Stop before sequences and tables if planning or DDL
    //    fails so no table is left with a missing custom type.
    let typePlan: CustomTypePlan;
    try {
      typePlan = await planCustomTypes(src, tgt, selectedTableNames);
    } catch (err) {
      report.typesFailed.push({
        name: "custom type planning",
        error: err instanceof Error ? err.message : String(err),
        ddl: "-- custom type planning",
        code:
          err && typeof err === "object"
            ? (err as PostgresErrorLike).code
            : undefined,
      });
      return report;
    }
    report.typesSkipped.push(...typePlan.skipped);
    report.typesFailed.push(...typePlan.failures);
    if (report.typesFailed.length > 0) return report;

    for (const definition of typePlan.definitions) {
      const qualifiedName = `${definition.schema}.${definition.type}`;
      try {
        for (const schema of new Set(definition.requiredSchemas)) {
          await tgt.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)}`);
        }
        await tgt.query(definition.ddl);
        report.typesCreated.push(qualifiedName);
      } catch (err) {
        report.typesFailed.push({
          name: qualifiedName,
          error: err instanceof Error ? err.message : String(err),
          ddl: definition.ddl,
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
        return report;
      }
    }

    // 4. Classify sequences before creating tables. Serial/default-backed
    //    sequences must exist before a DEFAULT nextval(...) expression is
    //    parsed. Identity sequences are deliberately not pre-created: the
    //    identity clause creates and internally owns those sequences.
    const sequences = await src.query<SourceSequenceDefinition>(`
      SELECT
        sequence_ns.nspname AS schema,
        sequence_class.relname AS name,
        pg_catalog.format_type(sequence_catalog.seqtypid, NULL) AS data_type,
        sequence_catalog.seqstart::text AS start_value,
        sequence_catalog.seqincrement::text AS increment_by,
        sequence_catalog.seqmin::text AS min_value,
        sequence_catalog.seqmax::text AS max_value,
        sequence_catalog.seqcache::text AS cache_size,
        sequence_catalog.seqcycle AS cycles,
        owner_ns.nspname AS owner_schema,
        owner_table.relname AS owner_table,
        owner_attribute.attname AS owner_column,
        owner_dependency.deptype AS dependency_type,
        COALESCE(
          (
            SELECT json_agg(
              default_reference
              ORDER BY default_reference.schema,
                       default_reference.table,
                       default_reference.column
            )
            FROM (
              SELECT DISTINCT
                default_ns.nspname AS schema,
                default_table.relname AS table,
                default_attribute.attname AS column
              FROM pg_depend default_dependency
              JOIN pg_attrdef attribute_default
                ON attribute_default.oid = default_dependency.objid
              JOIN pg_class default_table
                ON default_table.oid = attribute_default.adrelid
              JOIN pg_namespace default_ns
                ON default_ns.oid = default_table.relnamespace
              JOIN pg_attribute default_attribute
                ON default_attribute.attrelid = attribute_default.adrelid
               AND default_attribute.attnum = attribute_default.adnum
              WHERE default_dependency.classid = 'pg_attrdef'::regclass
                AND default_dependency.refclassid = 'pg_class'::regclass
                AND default_dependency.refobjid = sequence_class.oid
                AND default_dependency.deptype = 'n'
            ) default_reference
          ),
          '[]'::json
        ) AS default_references
      FROM pg_class sequence_class
      JOIN pg_namespace sequence_ns
        ON sequence_ns.oid = sequence_class.relnamespace
      JOIN pg_sequence sequence_catalog
        ON sequence_catalog.seqrelid = sequence_class.oid
      LEFT JOIN LATERAL (
        SELECT dependency.refobjid, dependency.refobjsubid, dependency.deptype
        FROM pg_depend dependency
        WHERE dependency.classid = 'pg_class'::regclass
          AND dependency.objid = sequence_class.oid
          AND dependency.objsubid = 0
          AND dependency.refclassid = 'pg_class'::regclass
          AND dependency.deptype IN ('a', 'i')
        ORDER BY CASE dependency.deptype WHEN 'i' THEN 0 ELSE 1 END
        LIMIT 1
      ) owner_dependency ON true
      LEFT JOIN pg_class owner_table
        ON owner_table.oid = owner_dependency.refobjid
      LEFT JOIN pg_namespace owner_ns
        ON owner_ns.oid = owner_table.relnamespace
      LEFT JOIN pg_attribute owner_attribute
        ON owner_attribute.attrelid = owner_dependency.refobjid
       AND owner_attribute.attnum = owner_dependency.refobjsubid
      WHERE sequence_class.relkind = 'S'
        AND sequence_ns.nspname <> 'information_schema'
        AND sequence_ns.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend extension_dependency
          WHERE extension_dependency.classid = 'pg_class'::regclass
            AND extension_dependency.objid = sequence_class.oid
            AND extension_dependency.deptype = 'e'
        )
      ORDER BY sequence_ns.nspname, sequence_class.relname
    `);
    const sequencesToCopy = selectedTableNames
      ? sequences.rows.filter(
          (sequence) => {
            const relatedTables = [
              ...(sequence.owner_schema && sequence.owner_table
                ? [`${sequence.owner_schema}.${sequence.owner_table}`]
                : []),
              ...(sequence.default_references ?? []).map(
                (reference) => `${reference.schema}.${reference.table}`,
              ),
            ];
            return relatedTables.some((table) => selectedTableNames.has(table));
          },
        )
      : sequences.rows;
    const identitySequencesByColumn = new Map(
      sequencesToCopy
        .filter(
          (sequence) =>
            sequence.dependency_type === "i" &&
            sequence.owner_schema &&
            sequence.owner_table &&
            sequence.owner_column,
        )
        .map((sequence) => [
          `${sequence.owner_schema}\0${sequence.owner_table}\0${sequence.owner_column}`,
          sequence,
        ]),
    );
    for (const sequence of sequencesToCopy) {
      if (sequence.dependency_type === "i") continue;
      const qualifiedName = qualifiedIdentifier(
        sequence.schema,
        sequence.name,
      );
      const ddl =
        `CREATE SEQUENCE IF NOT EXISTS ${qualifiedName} ` +
        `AS ${sequence.data_type} ${sequenceOptions(sequence)}`;
      try {
        await tgt.query(ddl);
      } catch (err) {
        report.tablesFailed.push({
          name: `${sequence.schema}.${sequence.name} (sequence)`,
          error: err instanceof Error ? err.message : String(err),
          ddl,
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
      }
    }

    // 5. Tables (user tables only, exclude tables owned by extensions like
    //    pg_stat_statements).
    const tables = await src.query<{ schema: string; table: string }>(`
      SELECT n.nspname AS schema, c.relname AS table
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = c.oid AND d.deptype = 'e'
        )
      ORDER BY c.relname
    `);

    const tablesToCopy = selectedTableNames
      ? tables.rows.filter((table) =>
          selectedTableNames.has(tableName(table)),
        )
      : tables.rows;

    for (const t of tablesToCopy) {
      const exists = await tgt.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname = $1 AND c.relname = $2",
        [t.schema, t.table],
      );
      if (parseInt(exists.rows[0].n, 10) > 0) {
        report.tablesSkipped.push(`${t.schema}.${t.table}`);
        continue;
      }

      // Use pg_catalog.format_type() for proper round-trippable types
      const cols = await src.query<{
        attname: string;
        formatted_type: string;
        attnotnull: boolean;
        attgenerated: "" | "s" | "v";
        attidentity: "" | "a" | "d";
        column_default: string | null;
      }>(
        `SELECT
           a.attname,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
           a.attnotnull,
           a.attgenerated,
           a.attidentity,
           pg_get_expr(ad.adbin, ad.adrelid) AS column_default
         FROM pg_attribute a
         LEFT JOIN pg_attrdef ad
           ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
         WHERE a.attrelid = ($1 || '.' || $2)::regclass
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [t.schema, t.table],
      );
      const pkCols = await src.query<{ attname: string }>(
        `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary
         ORDER BY array_position(i.indkey, a.attnum)`,
        [t.schema, t.table],
      );

      const pk =
        pkCols.rows.length > 0
          ? `, PRIMARY KEY (${pkCols.rows.map((p) => `"${p.attname}"`).join(", ")})`
          : "";
      const generatedColumnNames = cols.rows
        .filter((column) => column.attgenerated !== "")
        .map((column) => `${t.schema}.${t.table}.${column.attname}`);
      let ddl = "";
      try {
        const colDefs = cols.rows
          .map((column) => {
            const notNull = column.attnotnull ? " NOT NULL" : "";
            let value = "";
            if (column.attgenerated !== "") {
              if (!column.column_default) {
                throw new Error(
                  `Generated column ${t.schema}.${t.table}.${column.attname} has no generation expression.`,
                );
              }
              const persistence =
                column.attgenerated === "v" ? "VIRTUAL" : "STORED";
              value = ` GENERATED ALWAYS AS (${column.column_default}) ${persistence}`;
            } else if (column.attidentity !== "") {
              const identitySequence = identitySequencesByColumn.get(
                `${t.schema}\0${t.table}\0${column.attname}`,
              );
              if (!identitySequence) {
                throw new Error(
                  `Identity sequence metadata not found for ${t.schema}.${t.table}.${column.attname}.`,
                );
              }
              const generation =
                column.attidentity === "a" ? "ALWAYS" : "BY DEFAULT";
              value =
                ` GENERATED ${generation} AS IDENTITY (` +
                `SEQUENCE NAME ${qualifiedIdentifier(identitySequence.schema, identitySequence.name)} ` +
                `${sequenceOptions(identitySequence)})`;
            } else if (column.column_default) {
              value = ` DEFAULT ${column.column_default}`;
            }
            return `${quoteIdent(column.attname)} ${column.formatted_type}${value}${notNull}`;
          })
          .join(", ");
        ddl = `CREATE TABLE ${quoteIdent(t.schema)}.${quoteIdent(t.table)} (${colDefs}${pk})`;
        await tgt.query(ddl);
        report.tablesCreated.push(`${t.schema}.${t.table}`);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const generatedContext =
          generatedColumnNames.length > 0
            ? `Generated columns: ${generatedColumnNames.join(", ")}. `
            : "";
        report.tablesFailed.push({
          name: `${t.schema}.${t.table}`,
          error: `${generatedContext}${error}`,
          ddl:
            ddl ||
            `CREATE TABLE ${quoteIdent(t.schema)}.${quoteIdent(t.table)} (...)`,
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
      }
    }

    // Serial sequences are created without ownership because their tables do
    // not exist yet. Restore OWNED BY after table creation so
    // pg_get_serial_sequence(), DROP TABLE, and cutover discovery behave like
    // the source. Explicitly shared/unowned nextval() sequences stay unowned.
    for (const sequence of sequencesToCopy) {
      if (
        sequence.dependency_type !== "a" ||
        !sequence.owner_schema ||
        !sequence.owner_table ||
        !sequence.owner_column
      ) {
        continue;
      }
      const ddl =
        `ALTER SEQUENCE ${qualifiedIdentifier(sequence.schema, sequence.name)} ` +
        `OWNED BY ${qualifiedIdentifier(sequence.owner_schema, sequence.owner_table)}.${quoteIdent(sequence.owner_column)}`;
      try {
        await tgt.query(ddl);
      } catch (err) {
        report.tablesFailed.push({
          name: `${sequence.schema}.${sequence.name} (sequence ownership)`,
          error: err instanceof Error ? err.message : String(err),
          ddl,
          code:
            err && typeof err === "object"
              ? (err as PostgresErrorLike).code
              : undefined,
        });
      }
    }

    // 6. Indexes (non-PK, since PKs were inlined above).
    //    Use pg_get_indexdef() which produces fully qualified, valid DDL.
    const indexes = await src.query<{
      schema: string;
      table: string;
      indexname: string;
      indexdef: string;
    }>(`
      SELECT n.nspname AS schema,
             c.relname AS table,
             i.indexrelid::regclass::text AS indexname,
             pg_get_indexdef(i.indexrelid) AS indexdef
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname <> 'information_schema'
        AND n.nspname !~ '^pg_'
        AND NOT i.indisprimary
        AND NOT i.indisunique
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = i.indexrelid AND d.deptype = 'e'
        )
    `);
    const indexesToCopy = selectedTableNames
      ? indexes.rows.filter((index) =>
          selectedTableNames.has(tableName(index)),
        )
      : indexes.rows;
    for (const ix of indexesToCopy) {
      try {
        await tgt.query(ix.indexdef.replace(/^CREATE INDEX/, "CREATE INDEX IF NOT EXISTS"));
        report.indexesCreated++;
      } catch (err) {
        report.indexesFailed.push({
          name: ix.indexname,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
  return report;
}

export async function setupReplication(
  sourceConn: string,
  targetConn: string,
  opts: {
    publicationName?: string;
    subscriptionName?: string;
    tables?: string[];
  } = {},
): Promise<ReplicationSetupResult & { schemaReport: SchemaCopyReport }> {
  const pubName = opts.publicationName ?? DEFAULT_PUB;
  const subName = opts.subscriptionName ?? DEFAULT_SUB;
  const startedAt = new Date().toISOString();
  const existingResources = await inspectReplicationResources(
    sourceConn,
    targetConn,
  );
  if (existingResources.anyResourceExists) {
    if (existingResources.subscription.state === "present") {
      throw setupFailure(
        "verification",
        subName,
        new Error(
          `Subscription "${subName}" already exists. Resume monitoring instead of running setup again.`,
        ),
      );
    }
    const remainingResource =
      existingResources.slot.state !== "absent"
        ? `replication slot "${existingResources.slot.name ?? subName}"`
        : `publication "${pubName}"`;
    throw setupFailure(
      existingResources.slot.state !== "absent"
        ? "subscription-create"
        : "publication-create",
      existingResources.slot.name ?? pubName,
      new Error(
        `Setup blocked because ${remainingResource} remains from an earlier attempt. Complete setup recovery before retrying.`,
      ),
    );
  }
  let selectedTables: ReplicationTableRef[] | null;
  try {
    selectedTables = await resolveTableSelection(sourceConn, opts.tables);
  } catch (error) {
    throw setupFailure("verification", opts.tables?.[0] ?? null, error);
  }

  let schemaReport: SchemaCopyReport;
  try {
    schemaReport = await copySchemaIfNeeded(
      sourceConn,
      targetConn,
      selectedTables,
    );
  } catch (error) {
    throw setupFailure("schema-copy", null, error);
  }
  if (schemaReport.extensionsFailed.length > 0) {
    const firstFailure = schemaReport.extensionsFailed[0];
    throw setupFailure("schema-copy", firstFailure.name, {
      message: `Extension copy failed for ${firstFailure.name}. ${firstFailure.error}`,
      code: firstFailure.code,
    });
  }
  if (schemaReport.typesFailed.length > 0) {
    const firstFailure = schemaReport.typesFailed[0];
    throw setupFailure("schema-copy", firstFailure.name, {
      message: `Custom type copy failed for ${firstFailure.name}. ${firstFailure.error}`,
      code: firstFailure.code,
    });
  }
  if (schemaReport.tablesFailed.length > 0) {
    const firstFailure = schemaReport.tablesFailed[0];
    throw setupFailure("schema-copy", firstFailure.name, {
      message: `Schema copy failed for ${schemaReport.tablesFailed.length} table(s). ${firstFailure.error}`,
      code: firstFailure.code,
    });
  }

  let tables: string[] = [];
  try {
    const src = new Client({ connectionString: unpool(sourceConn) });
    await src.connect();
    try {
      const existing = await src.query<{ pubname: string }>(
        "SELECT pubname FROM pg_publication WHERE pubname = $1",
        [pubName],
      );
      if (existing.rows.length === 0) {
        if (selectedTables) {
          const tableList = selectedTables
            .map(
              (table) =>
                `${quoteIdent(table.schema)}.${quoteIdent(table.table)}`,
            )
            .join(", ");
          await src.query(
            `CREATE PUBLICATION ${quoteIdent(pubName)} FOR TABLE ${tableList}`,
          );
        } else {
          await src.query(
            `CREATE PUBLICATION ${quoteIdent(pubName)} FOR ALL TABLES`,
          );
        }
      }
      const publishedTables = await src.query<{
        schema: string;
        table: string;
      }>(
        `SELECT schemaname AS schema, tablename AS table
         FROM pg_publication_tables
         WHERE pubname = $1
         ORDER BY 1, 2`,
        [pubName],
      );
      tables = publishedTables.rows.map(tableName);
      if (selectedTables) {
        const expected = [...selectedTables]
          .map((table) => table.qualifiedName)
          .sort();
        const actual = [...tables].sort();
        if (
          expected.length !== actual.length ||
          expected.some((table, index) => table !== actual[index])
        ) {
          throw new Error(
            `Publication '${pubName}' already exists with a different table selection. Tear it down before starting a different selection.`,
          );
        }
      }
    } finally {
      await src.end().catch(() => undefined);
    }
  } catch (error) {
    throw setupFailure("publication-create", pubName, error);
  }

  try {
    const tgt = new Client({ connectionString: unpool(targetConn) });
    await tgt.connect();
    try {
      const existingSub = await tgt.query(
        "SELECT 1 FROM pg_subscription WHERE subname = $1",
        [subName],
      );
      if (existingSub.rows.length === 0) {
        // pg.Client doesn't allow parameterized DDL; the connection string is
        // resolved server-side for the authenticated user's selected project.
        const cleanConn = unpool(sourceConn).replace(/'/g, "''");
        await tgt.query(
          `CREATE SUBSCRIPTION ${quoteIdent(subName)} CONNECTION '${cleanConn}' PUBLICATION ${quoteIdent(pubName)} WITH (copy_data = true)`,
        );
      }
    } finally {
      await tgt.end().catch(() => undefined);
    }
  } catch (error) {
    throw setupFailure("subscription-create", subName, error);
  }

  try {
    const resources = await inspectReplicationResources(sourceConn, targetConn);
    if (
      resources.subscription.state !== "present" ||
      resources.publication.state !== "present" ||
      resources.slot.state === "absent"
    ) {
      throw new Error(
        `Setup verification found subscription=${resources.subscription.state}, publication=${resources.publication.state}, slot=${resources.slot.state}.`,
      );
    }
  } catch (error) {
    throw setupFailure("verification", subName, error);
  }

  return {
    publicationName: pubName,
    subscriptionName: subName,
    tables,
    startedAt,
    walLevelChanged: false,
    schemaCopied: true,
    schemaReport,
  };
}

/* ── Status ────────────────────────────────────────────────── */

/**
 * Compute real publisher → subscriber lag by querying BOTH sides:
 *   - Publisher: pg_current_wal_lsn() (what's been written)
 *   - Replication slot: confirmed_flush_lsn (what subscriber acknowledged)
 *   - Lag bytes = pg_wal_lsn_diff(current_wal, confirmed_flush_lsn)
 *
 * The subscriber-only `pg_lsn_diff(latest_end_lsn, received_lsn)` we used
 * before is almost always ~0 because those two LSNs update together, it
 * masks real lag where the publisher has WAL the subscriber hasn't pulled.
 *
 * `sourceConn` is optional so the simpler status() callers still work,
 * but cutover preflight always passes it in to get accurate numbers.
 */
export async function status(
  targetConn: string,
  subName: string = DEFAULT_SUB,
  sourceConn?: string,
): Promise<ReplicationStatus> {
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await tgt.connect();
  try {
    const sub = await tgt.query<{
      subname: string;
      subenabled: boolean;
      latest_end_lsn: string | null;
      last_msg_receipt_time: string | null;
      received_lsn: string | null;
      subslotname: string | null;
    }>(
      `SELECT s.subname, s.subenabled, s.subslotname::text,
              sr.latest_end_lsn::text, sr.last_msg_receipt_time, sr.received_lsn::text
       FROM pg_subscription s
       LEFT JOIN pg_stat_subscription sr ON sr.subname = s.subname
       WHERE s.subname = $1`,
      [subName],
    );
    if (sub.rows.length === 0) {
      return {
        subscriptionName: subName,
        subscribed: false,
        workerActive: false,
        receivedLsn: null,
        latestEndLsn: null,
        lagBytes: null,
        readyTables: 0,
        totalTables: 0,
        initialReplicationComplete: false,
        activeCopies: [],
        state: "stopped",
        perTable: [],
      };
    }

    const perTable = await tgt.query<{ srrelid: string; srsubstate: string }>(
      `SELECT srrelid::regclass::text AS srrelid, srsubstate
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       WHERE s.subname = $1`,
      [subName],
    );

    const tables = perTable.rows.map((r) => ({
      table: r.srrelid,
      state: mapState(r.srsubstate),
    }));

    const readyTables = tables.filter((t) => t.state === "Ready").length;
    const totalTables = tables.length;
    const initialReplicationComplete =
      totalTables > 0 && readyTables === totalTables;
    const activeCopies = await queryActiveLogicalReplicationCopies(tgt);

    // Real lag: ask the publisher how far ahead it is of the slot's
    // confirmed_flush_lsn. This is the byte volume the subscriber hasn't
    // received and confirmed yet.
    let lagBytes: number | null = null;
    if (sourceConn) {
      const src = new Client({ connectionString: unpool(sourceConn) });
      try {
        await src.connect();
        const r = await src.query<{ lag: string | null }>(
          `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::text AS lag
           FROM pg_replication_slots WHERE slot_name = $1`,
          [sub.rows[0].subslotname],
        );
        if (r.rows.length > 0 && r.rows[0].lag !== null) {
          lagBytes = parseInt(r.rows[0].lag, 10);
        }
      } catch {
        /* fall back to null, caller can interpret */
      } finally {
        await src.end().catch(() => undefined);
      }
    }

    // Fall back to subscriber-side ack diff if no source conn provided.
    // This is small but better than nothing and still surfaces some lag.
    if (
      lagBytes === null &&
      sub.rows[0].latest_end_lsn &&
      sub.rows[0].received_lsn
    ) {
      try {
        const r = await tgt.query<{ lag: string }>(
          "SELECT (pg_lsn_diff($1::pg_lsn, $2::pg_lsn))::text AS lag",
          [sub.rows[0].latest_end_lsn, sub.rows[0].received_lsn],
        );
        lagBytes = parseInt(r.rows[0].lag, 10);
      } catch {
        lagBytes = null;
      }
    }

    const state: ReplicationStatus["state"] =
      initialReplicationComplete && sub.rows[0].subenabled
          ? "streaming"
          : sub.rows[0].subenabled
            ? "copying"
          : "stopped";

    return {
      subscriptionName: subName,
      subscribed: true,
      workerActive: sub.rows[0].subenabled,
      receivedLsn: sub.rows[0].received_lsn,
      latestEndLsn: sub.rows[0].latest_end_lsn,
      lagBytes,
      readyTables,
      totalTables,
      initialReplicationComplete,
      activeCopies,
      state,
      perTable: tables,
    };
  } finally {
    await tgt.end();
  }
}

/* ── Monitoring (Neon recommended queries) ─────────────────── */

/** Verbatim from Neon docs, exposed in UI so users can paste into the
    Neon SQL editor for ad-hoc inspection. */
export const MONITOR_SQL = {
  subscriber: `SELECT sub.oid AS Subscription_ID, sub.subname AS Subscription_name,
       sub_rel.srrelid::regclass AS Table_name,
       CASE
           WHEN sub_rel.srsubstate = 'i' THEN 'Initialize'
           WHEN sub_rel.srsubstate = 'd' THEN 'Data being copied'
           WHEN sub_rel.srsubstate = 'f' THEN 'Finished table copy'
           WHEN sub_rel.srsubstate = 's' THEN 'Synchronized'
           WHEN sub_rel.srsubstate = 'r' THEN 'Ready'
       END AS Table_status,
       sub_rel.srsublsn AS Table_lsn
FROM pg_subscription_rel AS sub_rel
JOIN pg_subscription AS sub ON sub_rel.srsubid = sub.oid;`,
  publisher: `SELECT slot_name, confirmed_flush_lsn,
       pg_current_wal_lsn(),
       (pg_current_wal_lsn() - confirmed_flush_lsn) AS lsn_distance,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lsn_distance_size
FROM pg_replication_slots;`,
  activeCopies: `SELECT relid::regclass::text AS table_name,
       bytes_processed,
       tuples_processed
FROM pg_stat_progress_copy
WHERE type = 'CALLBACK'
  AND command = 'COPY FROM'
ORDER BY table_name;`,
};

function mapState(s: string): TableReplicationState {
  switch (s) {
    case "i":
      return "Initialize";
    case "d":
      return "Data being copied";
    case "f":
      return "Finished table copy";
    case "s":
      return "Synchronized";
    case "r":
      return "Ready";
    default:
      return "Unknown";
  }
}

async function queryActiveLogicalReplicationCopies(
  target: Client,
): Promise<LogicalReplicationCopyProgress[]> {
  const result = await target.query<{
    table_name: string;
    bytes_processed: string;
    tuples_processed: string;
  }>(
    `SELECT relid::regclass::text AS table_name,
            COALESCE(bytes_processed, 0)::text AS bytes_processed,
            COALESCE(tuples_processed, 0)::text AS tuples_processed
     FROM pg_stat_progress_copy
     WHERE type = 'CALLBACK'
       AND command = 'COPY FROM'
     ORDER BY table_name`,
  );
  return result.rows.map((row) => ({
    tableName: row.table_name,
    bytesProcessed: Number(row.bytes_processed),
    tuplesProcessed: Number(row.tuples_processed),
  }));
}

export async function monitor(
  sourceConn: string,
  targetConn: string,
): Promise<ReplicationMonitor> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const sub = await tgt.query<{
      oid: string;
      subname: string;
      tablename: string;
      state: string;
      lsn: string | null;
      slotname: string | null;
    }>(
      `SELECT s.oid::text AS oid, s.subname,
              s.subslotname::text AS slotname,
              sr.srrelid::regclass::text AS tablename,
              sr.srsubstate AS state,
              sr.srsublsn::text AS lsn
       FROM pg_subscription_rel sr
       JOIN pg_subscription s ON s.oid = sr.srsubid
       WHERE s.subname = $1
       ORDER BY s.subname, tablename`,
      [ADVISOR_SUBSCRIPTION],
    );
    const subscriber: SubscriberMonitorRow[] = sub.rows.map((r) => ({
      subscriptionId: parseInt(r.oid, 10),
      subscriptionName: r.subname,
      tableName: r.tablename,
      tableStatus: mapState(r.state),
      tableLsn: r.lsn,
    }));

    const pub = await src.query<{
      slot_name: string;
      confirmed_flush_lsn: string;
      current_wal_lsn: string;
      lsn_distance: string;
      lsn_distance_size: string;
    }>(
      `SELECT slot_name,
              confirmed_flush_lsn::text AS confirmed_flush_lsn,
              pg_current_wal_lsn()::text AS current_wal_lsn,
              (pg_current_wal_lsn() - confirmed_flush_lsn)::text AS lsn_distance,
              pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS lsn_distance_size
       FROM pg_replication_slots
       WHERE slot_name = $1
       ORDER BY slot_name`,
      [sub.rows[0]?.slotname ?? ADVISOR_SUBSCRIPTION],
    );
    const publisher: PublisherMonitorRow[] = pub.rows.map((r) => ({
      slotName: r.slot_name,
      confirmedFlushLsn: r.confirmed_flush_lsn,
      currentWalLsn: r.current_wal_lsn,
      lsnDistance: parseInt(r.lsn_distance, 10) || 0,
      lsnDistanceSize: r.lsn_distance_size,
    }));

    const initialReplicationComplete =
      subscriber.length > 0 && subscriber.every((r) => r.tableStatus === "Ready");
    const activeCopies = await queryActiveLogicalReplicationCopies(tgt);

    return {
      subscriber,
      publisher,
      activeCopies,
      initialReplicationComplete,
      sql: MONITOR_SQL,
    };
  } finally {
    await Promise.all([src.end(), tgt.end()]);
  }
}

/* ── Teardown ──────────────────────────────────────────────── */

export async function inspectReplicationResources(
  sourceConn: string,
  targetConn: string,
  slotNameHint?: string | null,
): Promise<ReplicationResourceInspection> {
  const src = new Client({ connectionString: unpool(sourceConn) });
  const tgt = new Client({ connectionString: unpool(targetConn) });
  await Promise.all([src.connect(), tgt.connect()]);
  try {
    const subscription = await tgt.query<{
      subenabled: boolean;
      subslotname: string | null;
      subpublications: string[];
    }>(
      `SELECT subenabled, subslotname::text, subpublications::text[]
       FROM pg_subscription
       WHERE subname = $1`,
      [ADVISOR_SUBSCRIPTION],
    );
    const sub = subscription.rows[0];
    // When the subscription is already gone, the only slot this application
    // creates by default is the fixed subscription name. A hint preserves an
    // actual non-default slot recorded earlier in the same teardown attempt.
    const slotName =
      sub?.subslotname ?? slotNameHint ?? ADVISOR_SUBSCRIPTION;
    const [publication, slot] = await Promise.all([
      src.query("SELECT 1 FROM pg_publication WHERE pubname = $1", [
        ADVISOR_PUBLICATION,
      ]),
      src.query<{ active: boolean; active_pid: number | null }>(
        `SELECT active, active_pid
         FROM pg_replication_slots
         WHERE slot_name = $1
           AND slot_type = 'logical'`,
        [slotName],
      ),
    ]);
    const slotRow = slot.rows[0];
    const result: ReplicationResourceInspection = {
      subscription: {
        name: ADVISOR_SUBSCRIPTION,
        state: sub ? "present" : "absent",
        enabled: sub?.subenabled ?? null,
        slotName: sub?.subslotname ?? null,
        publications: sub?.subpublications ?? [],
      },
      publication: {
        name: ADVISOR_PUBLICATION,
        state: publication.rows.length > 0 ? "present" : "absent",
      },
      slot: {
        name: slotRow ? slotName : sub?.subslotname ?? slotNameHint ?? null,
        state: slotRow ? (slotRow.active ? "active" : "present") : "absent",
        active: slotRow?.active ?? false,
        activePid: slotRow?.active_pid ?? null,
      },
      anyResourceExists: Boolean(
        sub || publication.rows.length > 0 || slotRow,
      ),
    };
    return result;
  } finally {
    await Promise.all([
      src.end().catch(() => undefined),
      tgt.end().catch(() => undefined),
    ]);
  }
}

function failedStep(
  id: ReplicationTeardownStep["id"],
  label: string,
  resource: string,
  detail: string,
): ReplicationTeardownStep {
  return { id, label, resource, status: "failed", detail };
}

export async function teardown(
  sourceConn: string,
  targetConn: string,
  opts: { releaseActiveSlot?: boolean } = {},
): Promise<ReplicationTeardownResult> {
  const before = await inspectReplicationResources(sourceConn, targetConn);
  const recordedSlotName = before.subscription.slotName ?? before.slot.name;
  const steps: ReplicationTeardownStep[] = [];
  const tgt = new Client({ connectionString: unpool(targetConn) });
  const src = new Client({ connectionString: unpool(sourceConn) });
  await Promise.all([tgt.connect(), src.connect()]);

  let targetClean = before.subscription.state === "absent";
  let slotClean = before.slot.state === "absent";
  try {
    if (before.subscription.state === "absent") {
      steps.push({
        id: "disable-subscription",
        label: "Disable target subscription",
        resource: ADVISOR_SUBSCRIPTION,
        status: "already absent",
        detail: "The target subscription is already absent.",
      });
    } else {
      try {
        await tgt.query(
          `ALTER SUBSCRIPTION "${ADVISOR_SUBSCRIPTION}" DISABLE`,
        );
        steps.push({
          id: "disable-subscription",
          label: "Disable target subscription",
          resource: ADVISOR_SUBSCRIPTION,
          status: "removed",
          detail: "The subscription was disabled.",
        });
      } catch (error) {
        steps.push(
          failedStep(
            "disable-subscription",
            "Disable target subscription",
            ADVISOR_SUBSCRIPTION,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    const disableFailed = steps.at(-1)?.status === "failed";
    const manualSlotCleanupRequired =
      !disableFailed &&
      before.subscription.state === "present" &&
      Boolean(recordedSlotName);

    if (before.subscription.state === "absent") {
      steps.push({
        id: "detach-slot",
        label: "Detach replication slot",
        resource: recordedSlotName ?? "replication slot",
        status: "already absent",
        detail: "No subscription exists, so there is no slot attachment.",
      });
    } else if (disableFailed) {
      steps.push(
        failedStep(
          "detach-slot",
          "Detach replication slot",
          recordedSlotName ?? "replication slot",
          "Not attempted because the subscription could not be disabled.",
        ),
      );
    } else if (!manualSlotCleanupRequired) {
      steps.push({
        id: "detach-slot",
        label: "Detach replication slot",
        resource: recordedSlotName ?? "replication slot",
        status: "already absent",
        detail: "Manual slot cleanup is not required.",
      });
    } else {
      try {
        await tgt.query(
          `ALTER SUBSCRIPTION "${ADVISOR_SUBSCRIPTION}" SET (slot_name = NONE)`,
        );
        steps.push({
          id: "detach-slot",
          label: "Detach replication slot",
          resource: recordedSlotName!,
          status: "removed",
          detail:
            "The recorded slot was detached so it can be verified and removed manually.",
        });
      } catch (error) {
        steps.push(
          failedStep(
            "detach-slot",
            "Detach replication slot",
            recordedSlotName!,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    const detachFailed =
      steps.find((step) => step.id === "detach-slot")?.status === "failed";
    if (before.subscription.state === "absent") {
      steps.push({
        id: "drop-subscription",
        label: "Drop target subscription",
        resource: ADVISOR_SUBSCRIPTION,
        status: "already absent",
        detail: "The target subscription is already absent.",
      });
    } else if (disableFailed || detachFailed) {
      steps.push(
        failedStep(
          "drop-subscription",
          "Drop target subscription",
          ADVISOR_SUBSCRIPTION,
          "Not attempted because the subscription could not be safely disabled and detached.",
        ),
      );
    } else {
      try {
        await tgt.query(`DROP SUBSCRIPTION "${ADVISOR_SUBSCRIPTION}"`);
        targetClean = true;
        steps.push({
          id: "drop-subscription",
          label: "Drop target subscription",
          resource: ADVISOR_SUBSCRIPTION,
          status: "removed",
          detail: "The target subscription was removed.",
        });
      } catch (error) {
        steps.push(
          failedStep(
            "drop-subscription",
            "Drop target subscription",
            ADVISOR_SUBSCRIPTION,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }

    if (!targetClean) {
      steps.push(
        failedStep(
          "confirm-slot-inactive",
          "Confirm source slot is inactive",
          recordedSlotName ?? "replication slot",
          "Not attempted because the target subscription remains.",
        ),
      );
      steps.push(
        failedStep(
          "drop-slot",
          "Drop source replication slot",
          recordedSlotName ?? "replication slot",
          "Not attempted because the target subscription remains.",
        ),
      );
    } else if (!recordedSlotName || before.slot.state === "absent") {
      slotClean = true;
      steps.push({
        id: "confirm-slot-inactive",
        label: "Confirm source slot is inactive",
        resource: recordedSlotName ?? "replication slot",
        status: "already absent",
        detail: "The source replication slot is already absent.",
      });
      steps.push({
        id: "drop-slot",
        label: "Drop source replication slot",
        resource: recordedSlotName ?? "replication slot",
        status: "already absent",
        detail: "The source replication slot is already absent.",
      });
    } else {
      let slot = await src.query<{
        active: boolean;
        active_pid: number | null;
      }>(
        "SELECT active, active_pid FROM pg_replication_slots WHERE slot_name = $1",
        [recordedSlotName],
      );
      if (slot.rows[0]?.active && opts.releaseActiveSlot) {
        const activePid = slot.rows[0].active_pid;
        if (activePid) {
          try {
            const released = await src.query<{ terminated: boolean }>(
              `SELECT pg_terminate_backend(active_pid) AS terminated
               FROM pg_replication_slots
               WHERE slot_name = $1
                 AND active
                 AND active_pid = $2`,
              [recordedSlotName, activePid],
            );
            if (released.rows[0]?.terminated) {
              steps.push({
                id: "release-slot-session",
                label: "Release active source session",
                resource: `${recordedSlotName} · PID ${activePid}`,
                status: "removed",
                detail:
                  "The explicitly confirmed app-owned replication session was ended.",
              });
            } else {
              steps.push(
                failedStep(
                  "release-slot-session",
                  "Release active source session",
                  `${recordedSlotName} · PID ${activePid}`,
                  "PostgreSQL did not end the active replication session.",
                ),
              );
            }
          } catch (error) {
            steps.push(
              failedStep(
                "release-slot-session",
                "Release active source session",
                `${recordedSlotName} · PID ${activePid}`,
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        } else {
          steps.push(
            failedStep(
              "release-slot-session",
              "Release active source session",
              recordedSlotName,
              "PostgreSQL reports the slot active but did not return an active PID.",
            ),
          );
        }
      }
      // Disabling the subscription is asynchronous. Give PostgreSQL a brief
      // chance to release the walsender. A backend is terminated only after
      // the user explicitly confirms the fixed app-owned slot and active PID.
      for (
        let attempt = 0;
        slot.rows[0]?.active && attempt < 10;
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        slot = await src.query<{
          active: boolean;
          active_pid: number | null;
        }>(
          "SELECT active, active_pid FROM pg_replication_slots WHERE slot_name = $1",
          [recordedSlotName],
        );
      }
      if (slot.rows.length === 0) {
        slotClean = true;
        steps.push({
          id: "confirm-slot-inactive",
          label: "Confirm source slot is inactive",
          resource: recordedSlotName,
          status: "already absent",
          detail: "The source replication slot is already absent.",
        });
        steps.push({
          id: "drop-slot",
          label: "Drop source replication slot",
          resource: recordedSlotName,
          status: "already absent",
          detail: "The source replication slot is already absent.",
        });
      } else if (slot.rows[0].active) {
        steps.push({
          id: "confirm-slot-inactive",
          label: "Confirm source slot is inactive",
          resource: recordedSlotName,
          status: "waiting",
          detail: `PostgreSQL still reports the slot as active${slot.rows[0].active_pid ? ` on PID ${slot.rows[0].active_pid}` : ""}. ${
            opts.releaseActiveSlot
              ? "The explicitly confirmed release attempt did not stop it."
              : "Automatic checks timed out without ending the backend."
          }`,
        });
        steps.push({
          id: "drop-slot",
          label: "Drop source replication slot",
          resource: recordedSlotName,
          status: "waiting",
          detail:
            "Waiting for PostgreSQL to report the slot inactive. An active slot is never force-dropped.",
        });
      } else {
        steps.push({
          id: "confirm-slot-inactive",
          label: "Confirm source slot is inactive",
          resource: recordedSlotName,
          status: "removed",
          detail: "PostgreSQL reports the source slot as inactive.",
        });
        try {
          await src.query("SELECT pg_drop_replication_slot($1)", [
            recordedSlotName,
          ]);
          slotClean = true;
          steps.push({
            id: "drop-slot",
            label: "Drop source replication slot",
            resource: recordedSlotName,
            status: "removed",
            detail: "The inactive source replication slot was removed.",
          });
        } catch (error) {
          steps.push(
            failedStep(
              "drop-slot",
              "Drop source replication slot",
              recordedSlotName,
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }
    }

    if (before.publication.state === "absent") {
      steps.push({
        id: "drop-publication",
        label: "Drop source publication",
        resource: ADVISOR_PUBLICATION,
        status: "already absent",
        detail: "The source publication is already absent.",
      });
    } else if (!targetClean || !slotClean) {
      steps.push({
        id: "drop-publication",
        label: "Drop source publication",
        resource: ADVISOR_PUBLICATION,
        status: steps.some((step) => step.status === "failed")
          ? "failed"
          : "waiting",
        detail:
          "Not attempted until the subscription and replication slot are removed.",
      });
    } else {
      try {
        await src.query(`DROP PUBLICATION "${ADVISOR_PUBLICATION}"`);
        steps.push({
          id: "drop-publication",
          label: "Drop source publication",
          resource: ADVISOR_PUBLICATION,
          status: "removed",
          detail: "The source publication was removed last.",
        });
      } catch (error) {
        steps.push(
          failedStep(
            "drop-publication",
            "Drop source publication",
            ADVISOR_PUBLICATION,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    }
  } finally {
    await Promise.all([
      src.end().catch(() => undefined),
      tgt.end().catch(() => undefined),
    ]);
  }

  const after = await inspectReplicationResources(
    sourceConn,
    targetConn,
    recordedSlotName,
  );
  const remainingResources = [
    after.subscription.state !== "absent"
      ? `subscription ${ADVISOR_SUBSCRIPTION}`
      : null,
    after.slot.state !== "absent" && after.slot.name
      ? `replication slot ${after.slot.name}`
      : null,
    after.publication.state !== "absent"
      ? `publication ${ADVISOR_PUBLICATION}`
      : null,
  ].filter((resource): resource is string => resource !== null);
  const replicationStopped = after.subscription.state === "absent";
  const cleanupComplete = remainingResources.length === 0;
  const waiting = steps.some((step) => step.status === "waiting");
  steps.push({
    id: "verify-removal",
    label: "Verify resource removal",
    resource: "all application-owned replication resources",
    status: cleanupComplete ? "removed" : waiting ? "waiting" : "failed",
    detail: cleanupComplete
      ? "Subscription, replication slot, and publication are absent."
      : `Still present: ${remainingResources.join(", ")}.`,
  });

  const recoveryInstructions = cleanupComplete
    ? []
    : [
        "Keep the source project available and retry teardown after resolving the failed step.",
        ...(after.subscription.state !== "absent"
          ? [`Disable and remove ${ADVISOR_SUBSCRIPTION} on the target first.`]
          : []),
        ...(after.slot.state === "active"
          ? [
              `The target subscription is ${after.subscription.state}. Replication slot ${after.slot.name} is still active${after.slot.activePid ? ` on backend PID ${after.slot.activePid}` : ""}. Explicitly confirm ending the app-owned replication session before retrying cleanup; an active slot is never force-dropped.`,
              `On the source, inspect SELECT slot_name, active, active_pid FROM pg_replication_slots WHERE slot_name = '${after.slot.name}'; and inspect the reported PID in pg_stat_activity.`,
            ]
          : after.slot.state === "present"
            ? [`Retry removal of inactive replication slot ${after.slot.name}.`]
            : []),
        ...(after.publication.state !== "absent"
          ? [
              `Remove ${ADVISOR_PUBLICATION} only after the subscription and slot are absent.`,
            ]
          : []),
      ];

  return {
    ok: cleanupComplete,
    replicationStopped,
    cleanupComplete,
    before,
    after,
    steps,
    remainingResources,
    recoveryInstructions,
  };
}
