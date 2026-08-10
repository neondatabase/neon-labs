#!/usr/bin/env bash
# ==============================================================================
# Neon Pre-Migration Data Collector  v1.0
# Step 1 of 2 — runs on the CUSTOMER side
# ==============================================================================
# PURPOSE
#   Collect PostgreSQL metadata needed to assess migration readiness to
#   Neon Serverless Postgres.  This script only READS system catalog data —
#   it never modifies your database and never copies row-level data.
#
# WHAT TO DO AFTER RUNNING
#   1. A ZIP file is created in the current directory.
#   2. Send it to your Neon Solutions Engineer.
#   3. Upload the ZIP to Neon Advisor to score
#      compatibility and produce a migration plan.
#
# REQUIREMENTS
#   - psql client (see --help for install instructions)
#   - Read access on pg_catalog and information_schema
#
# SOURCES
#   Query structure adapted from:
#     https://github.com/neondatabase/pg-prechecks (MIT License)
#   PostgreSQL system catalog reference:
#     https://www.postgresql.org/docs/current/catalogs.html
# ==============================================================================

set -euo pipefail

SCRIPT_VERSION="1.1"
BUNDLE_PREFIX="pg_assessment"
OUTPUT_DIR="${BUNDLE_PREFIX}_$(date +%Y%m%d_%H%M%S)"
ZIP_FILE="${OUTPUT_DIR}.zip"
ERROR_LOG=""

# ── Connection ────────────────────────────────────────────────────────────────
PGHOST=""
PGPORT="5432"
PGUSER=""
PGDATABASE="postgres"
PGSSLMODE="require"
DB_TYPE="generic"   # used as a hint in metadata; does not change what is collected

# ── Colors ────────────────────────────────────────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
log()   { echo -e "${BOLD}▸${NC} $*"; }
ok()    { echo -e "  ${GREEN}✓${NC} $*"; }
skip()  { echo -e "  ${YELLOW}–${NC} $* (skipped — insufficient privileges)"; }
fail()  { echo -e "  ${RED}✗${NC} $*"; }

# Run a query, saving output to a file.  On failure, write an error stub
# so the SA tool knows the query was attempted but could not run.
save_query() {
    local label="$1"   # human-readable name for log
    local file="$2"    # destination filename inside OUTPUT_DIR
    local query="$3"

    if PGPASSWORD="${PGPASSWORD:-}" PGSSLMODE="${PGSSLMODE}" \
       psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
            --csv -c "${query}" > "${OUTPUT_DIR}/${file}" 2>>"${ERROR_LOG}"; then
        ok "${label}"
    else
        echo "ERROR: query failed — check error.log" > "${OUTPUT_DIR}/${file}"
        skip "${label}"
    fi
}

save_query_plain() {
    local label="$1"
    local file="$2"
    local query="$3"

    if PGPASSWORD="${PGPASSWORD:-}" PGSSLMODE="${PGSSLMODE}" \
       psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
            -t -A -c "${query}" > "${OUTPUT_DIR}/${file}" 2>>"${ERROR_LOG}"; then
        ok "${label}"
    else
        echo "ERROR" > "${OUTPUT_DIR}/${file}"
        skip "${label}"
    fi
}

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
cat <<'HELP'
Neon Pre-Migration Data Collector — Usage & Connection Guide
================================================================

USAGE
  ./customer_pg_assessment.sh --host=HOST --user=USER [OPTIONS]

REQUIRED
  --host=HOST       Database server hostname or IP
  --user=USER       Database user

OPTIONAL
  --port=PORT       Port (default: 5432)
  --dbname=DB       Database name (default: postgres)
  --password=PASS   Password (prefer PGPASSWORD env var — see below)
  --db-type=TYPE    Source platform hint for Neon Advisor:
                    aws-rds | aws-aurora | azure-flexible | azure-single |
                    gcp-cloudsql | supabase | generic  (default: generic)
  --ssl-mode=MODE   disable | prefer | require | verify-full  (default: require)
  --help            Show this message

PASSWORD OPTIONS
  --password=PASS   Pass inline (shown in examples below)

  Or use PGPASSWORD env var:
    export PGPASSWORD="your_password"
    ./customer_pg_assessment.sh --host=... --user=...

  Or use ~/.pgpass (no password on command line):
    echo "hostname:5432:dbname:user:password" >> ~/.pgpass
    chmod 600 ~/.pgpass

INSTALL PSQL (if not already installed)
  macOS:   brew install libpq
           export PATH="$(brew --prefix libpq)/bin:$PATH"
  Ubuntu:  sudo apt-get install -y postgresql-client
  RHEL:    sudo yum install -y postgresql
  Windows: Install from https://www.postgresql.org/download/
           or use WSL with the Ubuntu instructions above

MINIMUM REQUIRED GRANTS (ask your DBA if you can't use the admin user)
  GRANT pg_monitor TO <your_user>;
  GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO <your_user>;
  GRANT SELECT ON ALL TABLES IN SCHEMA pg_catalog TO <your_user>;

================================================================
 CONNECTION EXAMPLES BY DATABASE TYPE
================================================================

1. AMAZON RDS FOR POSTGRESQL
   ./customer_pg_assessment.sh \
     --host=mydb.cxxx123.us-east-1.rds.amazonaws.com \
     --user=postgres \
     --password=your_password \
     --dbname=myappdb \
     --db-type=aws-rds

   Note: your IP must be allowed in the RDS Security Group (TCP 5432)

2. AMAZON AURORA POSTGRESQL
   Use the CLUSTER writer endpoint, not an instance endpoint.
   ./customer_pg_assessment.sh \
     --host=mycluster.cluster-cxxx123.us-east-1.rds.amazonaws.com \
     --user=postgres \
     --password=your_password \
     --dbname=myappdb \
     --db-type=aws-aurora

3. AZURE DATABASE FOR POSTGRESQL — FLEXIBLE SERVER
   ./customer_pg_assessment.sh \
     --host=myserver.postgres.database.azure.com \
     --user=adminuser \
     --password=your_password \
     --dbname=myappdb \
     --db-type=azure-flexible

   Note: add your IP under Networking → Firewall rules in the Azure Portal

4. AZURE DATABASE FOR POSTGRESQL — SINGLE SERVER (deprecated)
   Username must include @servername suffix.
   ./customer_pg_assessment.sh \
     --host=myserver.postgres.database.windows.net \
     --user=adminuser@myserver \
     --password=your_password \
     --dbname=myappdb \
     --db-type=azure-single

5. GOOGLE CLOUD SQL — via Cloud SQL Auth Proxy (recommended)
   # Terminal 1: start proxy
   ./cloud-sql-proxy --port=5433 project:region:instance
   # Terminal 2: run assessment
   ./customer_pg_assessment.sh \
     --host=127.0.0.1 \
     --port=5433 \
     --user=postgres \
     --password=your_password \
     --dbname=myappdb \
     --db-type=gcp-cloudsql \
     --ssl-mode=disable

6. SUPABASE
   Use the "Direct connection" string from your Supabase dashboard
   (not the pooler connection).
   ./customer_pg_assessment.sh \
     --host=db.abcdefghijklm.supabase.co \
     --user=postgres \
     --password=your_password \
     --dbname=postgres \
     --db-type=supabase

7. SELF-MANAGED / ON-PREMISE
   ./customer_pg_assessment.sh \
     --host=192.168.1.100 \
     --user=postgres \
     --password=your_password \
     --dbname=myappdb \
     --db-type=generic \
     --ssl-mode=prefer
HELP
    exit 0
}

# ── Arg parsing ───────────────────────────────────────────────────────────────
[[ $# -eq 0 ]] && usage

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host=*)     PGHOST="${1#*=}" ;;
        --port=*)     PGPORT="${1#*=}" ;;
        --user=*)     PGUSER="${1#*=}" ;;
        --dbname=*)   PGDATABASE="${1#*=}" ;;
        --password=*) export PGPASSWORD="${1#*=}" ;;
        --db-type=*)  DB_TYPE="${1#*=}" ;;
        --ssl-mode=*) PGSSLMODE="${1#*=}" ;;
        --help|-h)    usage ;;
        *) echo -e "${RED}Unknown argument: $1${NC}  (run --help for usage)" >&2; exit 1 ;;
    esac
    shift
done

if [[ -z "${PGHOST}" || -z "${PGUSER}" ]]; then
    echo -e "${RED}Error: --host and --user are required.${NC}  Run --help for usage." >&2
    exit 1
fi

# ── Pre-flight ────────────────────────────────────────────────────────────────
if ! command -v psql &>/dev/null; then
    echo -e "${RED}Error: psql not found.${NC}  Run --help for install instructions." >&2
    exit 1
fi

echo ""
echo -e "${BOLD}Neon Pre-Migration Data Collector  v${SCRIPT_VERSION}${NC}"
echo ""
log "Connecting to ${PGHOST}:${PGPORT}/${PGDATABASE} as ${PGUSER} ..."

if ! PGPASSWORD="${PGPASSWORD:-}" PGSSLMODE="${PGSSLMODE}" \
     psql -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" \
          -c "SELECT 1;" &>/dev/null; then
    echo ""
    echo -e "${RED}Connection failed.${NC}  Troubleshooting steps:"
    echo "  1. Verify host, user, and password"
    echo "  2. Check firewall / security group rules allow TCP ${PGPORT} from your IP"
    echo "  3. Try --ssl-mode=prefer if SSL handshake is failing"
    echo "  4. Test manually:"
    echo "     PGPASSWORD='...' psql -h ${PGHOST} -p ${PGPORT} -U ${PGUSER} -d ${PGDATABASE}"
    exit 1
fi
ok "Connected"

# ── Collect data ──────────────────────────────────────────────────────────────
mkdir -p "${OUTPUT_DIR}"
ERROR_LOG="${OUTPUT_DIR}/error.log"
touch "${ERROR_LOG}"

echo ""
log "Collecting database metadata (read-only, no row data copied) ..."
echo ""

# Server version
save_query_plain "Server version" \
    "version.txt" \
    "SELECT version();"

# Version number (machine-readable)
save_query_plain "Version number" \
    "version_num.txt" \
    "SELECT current_setting('server_version_num')::int / 10000;"

# Databases inventory
save_query "Databases" \
    "databases.csv" \
    "SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size,
            pg_encoding_to_char(encoding) AS encoding,
            datcollate AS collation, datctype AS ctype
     FROM pg_database WHERE datistemplate = false ORDER BY pg_database_size(datname) DESC;"

# Extensions
save_query "Extensions" \
    "extensions.csv" \
    "SELECT e.extname, e.extversion, n.nspname AS schema
     FROM pg_extension e JOIN pg_namespace n ON e.extnamespace = n.oid
     ORDER BY extname;"

# Extension usage — objects depending on each extension
save_query "Extension object dependencies" \
    "extension_usage.csv" \
    "SELECT e.extname AS extension,
            count(DISTINCT d.objid) AS dependent_objects,
            count(DISTINCT CASE WHEN c.relkind = 'r' THEN d.objid END) AS tables,
            count(DISTINCT CASE WHEN c.relkind = 'i' THEN d.objid END) AS indexes,
            count(DISTINCT CASE WHEN c.relkind IS NULL THEN d.objid END) AS other_objects
     FROM pg_extension e
     JOIN pg_depend d ON d.refobjid = e.oid AND d.deptype = 'e'
     LEFT JOIN pg_class c ON c.oid = d.objid
     WHERE e.extname != 'plpgsql'
     GROUP BY e.extname
     ORDER BY dependent_objects DESC;"

# Columns using extension-provided types (PostGIS geometry, hstore, vector, etc.)
save_query "Extension type usage in columns" \
    "extension_type_columns.csv" \
    "SELECT e.extname AS extension,
            t.typname AS type_name,
            count(*) AS column_count,
            count(DISTINCT c.relname) AS table_count
     FROM pg_attribute a
     JOIN pg_class c ON a.attrelid = c.oid
     JOIN pg_namespace n ON c.relnamespace = n.oid
     JOIN pg_type t ON a.atttypid = t.oid
     JOIN pg_depend d ON d.objid = t.oid AND d.deptype = 'e'
     JOIN pg_extension e ON d.refobjid = e.oid
     WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND a.attnum > 0
       AND NOT a.attisdropped
     GROUP BY e.extname, t.typname
     ORDER BY column_count DESC;"

# Indexes using extension-provided operator classes
save_query "Extension index usage" \
    "extension_indexes.csv" \
    "SELECT e.extname AS extension,
            am.amname AS index_method,
            count(*) AS index_count,
            pg_size_pretty(sum(pg_relation_size(i.indexrelid))) AS total_index_size
     FROM pg_index i
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_namespace n ON ic.relnamespace = n.oid
     JOIN pg_opclass oc ON oc.oid = ANY(i.indclass)
     JOIN pg_am am ON am.oid = ic.relam
     JOIN pg_depend d ON d.objid = oc.oid AND d.deptype = 'e'
     JOIN pg_extension e ON d.refobjid = e.oid
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
     GROUP BY e.extname, am.amname
     ORDER BY index_count DESC;"

# Roles (no password hashes)
save_query "Roles" \
    "roles.csv" \
    "SELECT rolname, rolsuper, rolcreaterole, rolcreatedb,
            rolreplication, rolcanlogin, rolconnlimit
     FROM pg_roles WHERE rolname NOT LIKE 'pg_%'
     ORDER BY rolname;"

# Tablespaces
save_query "Tablespaces" \
    "tablespaces.csv" \
    "SELECT spcname, pg_tablespace_location(oid) AS location
     FROM pg_tablespace ORDER BY spcname;"

# Key server settings
save_query "Server settings" \
    "settings.csv" \
    "SELECT name, setting, unit, context
     FROM pg_settings
     WHERE name IN (
         'max_connections','shared_buffers','work_mem',
         'maintenance_work_mem','effective_cache_size',
         'wal_level','max_wal_senders','max_replication_slots',
         'max_prepared_transactions','track_commit_timestamp',
         'max_locks_per_transaction','statement_timeout',
         'idle_in_transaction_session_timeout','log_min_duration_statement',
         'autovacuum','autovacuum_max_workers','default_toast_compression'
     )
     ORDER BY name;"

# Tables without primary keys
save_query "Tables without primary keys" \
    "tables_without_pk.csv" \
    "SELECT n.nspname AS schema, c.relname AS table_name,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size
     FROM pg_class c
     JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND NOT EXISTS (
           SELECT 1 FROM pg_constraint k
           WHERE k.conrelid = c.oid AND k.contype = 'p'
       )
     ORDER BY pg_total_relation_size(c.oid) DESC;"

# Unlogged tables
save_query "Unlogged tables" \
    "unlogged_tables.csv" \
    "SELECT n.nspname AS schema, c.relname AS table_name,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size
     FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE c.relpersistence = 'u'
       AND n.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY pg_total_relation_size(c.oid) DESC;"

# Foreign Data Wrappers
save_query "Foreign Data Wrappers" \
    "fdw.csv" \
    "SELECT fdwname, fdwhandler::regproc AS handler,
            fdwvalidator::regproc AS validator
     FROM pg_foreign_data_wrapper ORDER BY fdwname;"

# Procedural languages
save_query "Procedural languages" \
    "languages.csv" \
    "SELECT lanname, lanpltrusted AS trusted
     FROM pg_language ORDER BY lanname;"

# Partitioned tables
save_query "Partitioned tables" \
    "partitions.csv" \
    "SELECT n.nspname AS schema, c.relname AS parent_table,
            count(i.inhrelid) AS partition_count
     FROM pg_class c
     JOIN pg_namespace n ON c.relnamespace = n.oid
     LEFT JOIN pg_inherits i ON i.inhparent = c.oid
     WHERE c.relkind = 'p'
       AND n.nspname NOT IN ('pg_catalog','information_schema')
     GROUP BY n.nspname, c.relname;"

# Generated columns
save_query "Generated columns" \
    "generated_columns.csv" \
    "SELECT table_schema, table_name, column_name, data_type, generation_expression
     FROM information_schema.columns
     WHERE is_generated = 'ALWAYS'
     ORDER BY table_schema, table_name, column_name;"

# Event triggers
save_query "Event triggers" \
    "event_triggers.csv" \
    "SELECT evtname, evtevent, evtowner::regrole AS owner,
            evtfoid::regproc AS function, evtenabled
     FROM pg_event_trigger ORDER BY evtname;"

# User-defined functions (name + language only — no source code)
save_query "User-defined functions" \
    "functions.csv" \
    "SELECT n.nspname AS schema, p.proname AS name,
            l.lanname AS language,
            pg_get_function_result(p.oid) AS return_type,
            CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'INVOKER' END AS security,
            CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE'
                               WHEN 's' THEN 'STABLE'
                               ELSE 'VOLATILE' END AS volatility
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     JOIN pg_language l ON p.prolang = l.oid
     WHERE n.nspname NOT IN ('pg_catalog','information_schema')
     ORDER BY n.nspname, p.proname;"

# Replication status
save_query "WAL / replication" \
    "replication_slots.csv" \
    "SELECT slot_name, plugin, slot_type, active, restart_lsn
     FROM pg_replication_slots ORDER BY slot_name;"

save_query "Publications" \
    "publications.csv" \
    "SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete
     FROM pg_publication ORDER BY pubname;"

# Active streaming replicas (TCO input: read_replica_count)
save_query "Streaming replicas" \
    "streaming_replicas.csv" \
    "SELECT application_name, client_addr, state, sync_state,
            pg_wal_lsn_diff(sent_lsn, replay_lsn) AS replay_lag_bytes
     FROM pg_stat_replication ORDER BY application_name;"

# Database total size (TCO input: db_size_gb)
save_query "Database size" \
    "database_size.csv" \
    "SELECT pg_database.datname,
            pg_database_size(pg_database.datname) AS size_bytes,
            pg_size_pretty(pg_database_size(pg_database.datname)) AS size_pretty
     FROM pg_database
     WHERE datistemplate = false
     ORDER BY pg_database_size(pg_database.datname) DESC;"

# Table sizes (top 50)
save_query "Table sizes" \
    "table_sizes.csv" \
    "SELECT n.nspname AS schema, c.relname AS table_name,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
            pg_size_pretty(pg_table_size(c.oid)) AS table_only,
            pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
            c.reltuples::bigint AS estimated_rows
     FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE c.relkind = 'r'
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
     ORDER BY pg_total_relation_size(c.oid) DESC
     LIMIT 50;"

# Object counts
save_query "Object counts" \
    "object_counts.csv" \
    "SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
         WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')) AS tables,
        (SELECT count(*) FROM pg_indexes
         WHERE schemaname NOT IN ('pg_catalog','information_schema'))                  AS indexes,
        (SELECT count(*) FROM pg_views
         WHERE schemaname NOT IN ('pg_catalog','information_schema'))                  AS views,
        (SELECT count(*) FROM pg_matviews
         WHERE schemaname NOT IN ('pg_catalog','information_schema'))                  AS matviews,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
         WHERE n.nspname NOT IN ('pg_catalog','information_schema'))                   AS functions,
        (SELECT count(*) FROM pg_trigger t
         JOIN pg_class c ON t.tgrelid=c.oid
         JOIN pg_namespace n ON c.relnamespace=n.oid
         WHERE n.nspname NOT IN ('pg_catalog','information_schema')
           AND NOT t.tgisinternal)                                                     AS triggers,
        (SELECT count(*) FROM information_schema.sequences
         WHERE sequence_schema NOT IN ('pg_catalog','information_schema'))             AS sequences;"

# Collations in use (non-default)
save_query "Custom collations" \
    "collations.csv" \
    "SELECT collname, collprovider, collencoding, collcollate
     FROM pg_collation
     WHERE collname NOT IN ('default','C','POSIX','ucs_basic')
       AND collprovider = 'c'
     LIMIT 30;"

# Connection activity summary
save_query "Connection summary" \
    "connections.csv" \
    "SELECT state, count(*) AS connections,
            max(extract(epoch FROM now() - state_change))::int AS longest_seconds
     FROM pg_stat_activity WHERE pid != pg_backend_pid()
     GROUP BY state ORDER BY count(*) DESC;"

# Prepared transactions
save_query "Prepared transactions" \
    "prepared_transactions.csv" \
    "SELECT gid, prepared, owner, database
     FROM pg_prepared_xacts ORDER BY prepared;"

# Large objects
save_query_plain "Large object count" \
    "large_objects.txt" \
    "SELECT count(*) FROM pg_largeobject_metadata;"

# ── Workload signal ────────────────────────────────────────────────────────────
log "Collecting workload signal…"

save_query "Per-database activity (pg_stat_database)" \
    "database_activity.csv" \
    "SELECT datname, xact_commit, xact_rollback, blks_hit, blks_read,
            CASE WHEN (blks_hit + blks_read) > 0
              THEN ROUND(100.0 * blks_hit / (blks_hit + blks_read), 2)
              ELSE NULL END AS cache_hit_pct,
            tup_returned, tup_fetched,
            tup_inserted, tup_updated, tup_deleted,
            temp_files, temp_bytes, deadlocks, stats_reset
     FROM pg_stat_database
     WHERE datname IS NOT NULL
       AND datname NOT IN ('template0','template1');"

save_query "Workload signal (read/write ratio)" \
    "workload_signal.csv" \
    "SELECT
       SUM(tup_returned + tup_fetched)              AS reads,
       SUM(tup_inserted + tup_updated + tup_deleted) AS writes,
       CASE WHEN SUM(tup_inserted + tup_updated + tup_deleted) > 0
         THEN ROUND(SUM(tup_returned + tup_fetched)::numeric
                  / SUM(tup_inserted + tup_updated + tup_deleted), 2)
         ELSE NULL END                               AS read_write_ratio,
       SUM(xact_commit + xact_rollback)              AS total_transactions
     FROM pg_stat_database
     WHERE datname NOT IN ('template0','template1');"

save_query "Server uptime" \
    "uptime.csv" \
    "SELECT pg_postmaster_start_time() AS started_at,
            NOW()                       AS now,
            EXTRACT(EPOCH FROM (NOW() - pg_postmaster_start_time()))::bigint
              AS uptime_seconds;"

save_query "HA / replication hint" \
    "ha_hint.csv" \
    "SELECT current_setting('synchronous_commit',         true) AS synchronous_commit,
            current_setting('synchronous_standby_names',  true) AS synchronous_standby_names,
            current_setting('wal_level',                  true) AS wal_level,
            (SELECT COUNT(*) FROM pg_stat_replication)         AS streaming_replicas,
            (SELECT COUNT(*) FROM pg_stat_replication
              WHERE sync_state IN ('sync','quorum'))           AS sync_replicas;"

save_query "Query stats (pg_stat_statements, optional)" \
    "query_stats.csv" \
    "SELECT COUNT(*)                          AS distinct_queries,
            SUM(calls)                        AS total_calls,
            ROUND(SUM(total_exec_time)/1000.0) AS total_exec_seconds,
            SUM(rows)                         AS total_rows
     FROM pg_stat_statements;"

# ── Write metadata ─────────────────────────────────────────────────────────────
PG_VERSION_MAJOR=$(cat "${OUTPUT_DIR}/version_num.txt" 2>/dev/null | tr -d '[:space:]' || echo "unknown")
PG_VERSION_FULL=$(cat "${OUTPUT_DIR}/version.txt"     2>/dev/null | tr -d '\n'         || echo "unknown")

python3 -c "
import json, datetime, sys
meta = {
  'assessment_date': datetime.datetime.utcnow().isoformat() + 'Z',
  'script_version': '${SCRIPT_VERSION}',
  'db_type': '${DB_TYPE}',
  'pg_version_major': '${PG_VERSION_MAJOR}',
  'pg_version_full': sys.argv[1],
  'port': ${PGPORT},
  'database': '${PGDATABASE}'
}
print(json.dumps(meta, indent=2))
" "${PG_VERSION_FULL}" > "${OUTPUT_DIR}/metadata.json" 2>/dev/null || \
  echo "{\"assessment_date\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"db_type\":\"${DB_TYPE}\",\"script_version\":\"${SCRIPT_VERSION}\"}" \
  > "${OUTPUT_DIR}/metadata.json"

ok "Metadata file"

# ── Package bundle ────────────────────────────────────────────────────────────
echo ""
log "Creating bundle ..."

if command -v zip &>/dev/null; then
    zip -r "${ZIP_FILE}" "${OUTPUT_DIR}/" -x "*.DS_Store" >/dev/null
    BUNDLE="${ZIP_FILE}"
else
    tar -czf "${OUTPUT_DIR}.tar.gz" "${OUTPUT_DIR}/"
    BUNDLE="${OUTPUT_DIR}.tar.gz"
fi
ok "Bundle created: ${BOLD}${BUNDLE}${NC}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Assessment data collected successfully${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Send this file to your Neon Solutions Engineer:${NC}"
echo -e "  ${BOLD}  ${BUNDLE}${NC}"
echo ""
echo -e "  PostgreSQL version : ${CYAN}${PG_VERSION_MAJOR}${NC}"
echo -e "  Source type        : ${CYAN}${DB_TYPE}${NC}"
echo -e "  Output directory   : ${CYAN}${OUTPUT_DIR}/${NC}"
if [[ -s "${ERROR_LOG}" ]]; then
    echo ""
    echo -e "  ${YELLOW}Some queries were skipped — see ${OUTPUT_DIR}/error.log${NC}"
    echo -e "  ${YELLOW}(This is usually a permissions issue, not critical.)${NC}"
fi
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
