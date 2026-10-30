#!/usr/bin/env bash
set -Eeuo pipefail
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-yoleotard-crm}";COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.portainer.yml}";ENV_FILE="${ENV_FILE:-.env}";PRODUCTION_DATABASE="${PRODUCTION_DATABASE:-yoleotard_crm}"
BACKUP_DIR="";BACKUP_ID="";TARGET_DATABASE="";CONFIRM="";UPLOADS_TARGET=""
usage(){ echo "Usage: $0 (--backup-id ID|--backup-dir ABSOLUTE_DIRECTORY) --target-database NON_PRODUCTION_DATABASE --confirm 'RESTORE DATABASE' [--uploads-target ABSOLUTE_EMPTY_DIRECTORY]" >&2; }
while (($#));do case "$1" in --backup-id) BACKUP_ID="${2:-}";shift 2;;--backup-dir) BACKUP_DIR="${2:-}";shift 2;;--target-database) TARGET_DATABASE="${2:-}";shift 2;;--confirm) CONFIRM="${2:-}";shift 2;;--uploads-target) UPLOADS_TARGET="${2:-}";shift 2;;--compose-file) COMPOSE_FILE="${2:-}";shift 2;;--env-file) ENV_FILE="${2:-}";shift 2;;-h|--help) usage;exit 0;;*) echo "Unknown argument: $1" >&2;usage;exit 2;;esac;done
[[ "${ALLOW_RESTORE:-false}" == "true" ]]||{ echo "Restore is disabled; set ALLOW_RESTORE=true only for an isolated drill" >&2;exit 2; }
[[ "$COMPOSE_PROJECT_NAME" =~ ^(yo-recovery-|yocrm-drill-|yoleotard-crm-backup-drill) ]] || { echo 'Restore requires a separate isolated project' >&2;exit 2; }
[[ "${APP_ENV:-}" == "backup-drill" ]] || { echo "CLI restore requires explicit APP_ENV=backup-drill" >&2; exit 2; }
if [[ -n "$BACKUP_ID" ]];then [[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]||exit 2;[[ -n "${BACKUP_STORAGE_PATH:-}" ]]||{ echo "BACKUP_STORAGE_PATH is required" >&2;exit 2; };BACKUP_DIR="${BACKUP_STORAGE_PATH%/}/$BACKUP_ID";fi
[[ "$BACKUP_DIR" = /* && -d "$BACKUP_DIR" ]]||{ echo "Backup directory must be an existing absolute directory" >&2;exit 2; };[[ "$TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]||exit 2;[[ "$TARGET_DATABASE" != "$PRODUCTION_DATABASE" ]]||{ echo "Refusing production database" >&2;exit 2; };[[ "$CONFIRM" == "RESTORE $TARGET_DATABASE" ]]||{ echo "Invalid confirmation" >&2;exit 2; }
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]||exit 1;command -v docker >/dev/null||exit 1;command -v sha256sum >/dev/null||exit 1
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo 'python3 is required' >&2;exit 1; }
BACKUP_DIR="$(realpath --canonicalize-existing -- "$BACKUP_DIR")"
export BACKUP_STORAGE_PATH="${BACKUP_STORAGE_PATH:-$(dirname -- "$BACKUP_DIR")}"
. "$SCRIPT_DIR/backup-lock.sh"
# backup_archive.py handles legacy manifest.txt format_version=1, v2/v3 and backup id mismatch.
python3 "$SCRIPT_DIR/backup_archive.py" validate "$BACKUP_DIR" ${BACKUP_ID:+--expected-id "$BACKUP_ID"} >/dev/null
(cd -- "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
export COMPOSE_PROJECT_NAME COMPOSE_FILE ENV_FILE
# All filesystem preconditions precede the first database write.
if [[ -n "$UPLOADS_TARGET" ]];then
  [[ "$UPLOADS_TARGET" = /* && "$UPLOADS_TARGET" != / && ! -L "$UPLOADS_TARGET" ]] || exit 2
  mkdir -p -- "$UPLOADS_TARGET"
  UPLOADS_TARGET="$(realpath --canonicalize-existing -- "$UPLOADS_TARGET")"
  [[ "$UPLOADS_TARGET" != "$BACKUP_DIR" && "$UPLOADS_TARGET" != "$BACKUP_DIR/"* && "$BACKUP_DIR" != "$UPLOADS_TARGET/"* ]] || exit 2
  [[ -z "$(find "$UPLOADS_TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo 'Uploads target must be empty' >&2;exit 2; }
  [[ -w "$UPLOADS_TARGET" ]] || exit 2
fi
export SCRIPT_DIR BACKUP_DIR BACKUP_ID TARGET_DATABASE UPLOADS_TARGET
# The complete SQL stage shares one 300s budget, including catalog parsing,
# metadata/lease queries and reconciliation. The host supervisor inspects actual
# tmpfs/cgroup isolation before starting this stage and kills that exact sandbox
# on failure/timeout so server-side SQL/COPY PROGRAM children cannot outlive it.
python3 "$SCRIPT_DIR/backup_runtime.py" bounded-legacy-restore "$BACKUP_DIR" <<'BOUNDED_LEGACY_SQL'
set -Eeuo pipefail
compose=(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE");ACTIVE_DATABASE="$("${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres printenv POSTGRES_DB|tr -d '\r')";[[ "$TARGET_DATABASE" != "$ACTIVE_DATABASE" ]]||{ echo "Refusing active database" >&2;exit 2; }
if [[ -n "$BACKUP_ID" ]]; then
  EXPECTED_METADATA="$("${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator="|" --command="SELECT COALESCE(\"checksum\",'"'"''"'"') || '"'"'|'"'"' || COALESCE(\"sizeBytes\"::text,'"'"''"'"') FROM \"Backup\" WHERE \"id\"='"'"'$1'"'"' AND \"status\"='"'"'COMPLETED'"'"'"' sh "$BACKUP_ID" | tr -d '\r')"
  ACTUAL_CHECKSUM="$(sha256sum "$BACKUP_DIR/manifest.json" | cut -d' ' -f1)"
  ACTUAL_SIZE="$(python3 "$SCRIPT_DIR/backup_archive.py" validate "$BACKUP_DIR" | python3 -c 'import sys,json;print(json.load(sys.stdin)["sizeBytes"])')"
  [[ "$EXPECTED_METADATA" == "$ACTUAL_CHECKSUM|$ACTUAL_SIZE" ]] || { echo "Backup artifacts do not match completed metadata" >&2; exit 1; }
fi
"${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '\''$1'\''"' sh "$TARGET_DATABASE"|grep -qx '1'||{ echo "Target database does not exist" >&2;exit 1; }
TARGET_OBJECT_COUNT="$("${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"') AND n.nspname !~ '"'"'^pg_toast'"'"') + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"')) + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"') AND n.nspname !~ '"'"'^pg_toast'"'"') + (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('"'"'public'"'"','"'"'pg_catalog'"'"','"'"'information_schema'"'"') AND nspname !~ '"'"'^pg_'"'"')"' sh "$TARGET_DATABASE" | tr -d '\r')"
[[ "$TARGET_OBJECT_COUNT" == "0" ]] || { echo "Target database must be freshly created and contain no user objects" >&2; exit 2; }
# Catalog parsing and resource checks must also precede the first DB mutation.
"${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres pg_restore --list < "$BACKUP_DIR/postgres.dump" >/dev/null
if [[ -n "$UPLOADS_TARGET" ]];then
  python3 -c 'import json,shutil,sys; from pathlib import Path;sys.path.insert(0,sys.argv[3]);from backup_archive import validate_directory; n=sum(x["sizeBytes"] for x in validate_directory(Path(sys.argv[1]))["inventory"]);assert shutil.disk_usage(sys.argv[2]).free>n+67108864,"insufficient uploads space"' "$BACKUP_DIR" "$UPLOADS_TARGET" "$SCRIPT_DIR"
fi
# The host supervisor owns the bounded standalone lease; no job watchdog.

"${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec pg_restore --username="$POSTGRES_USER" --dbname="$1" --no-owner --no-privileges --exit-on-error --single-transaction' sh "$TARGET_DATABASE" < "$BACKUP_DIR/postgres.dump"
HAS_BACKUP_TABLE="$("${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT to_regclass('"'"'public.\"Backup\"'"'"') IS NOT NULL"' sh "$TARGET_DATABASE" | tr -d '\r')"
if [[ "$HAS_BACKUP_TABLE" == "t" ]]; then
  "${compose[@]}" exec -T -e "PGOPTIONS=-c statement_timeout=30000 -c lock_timeout=10000" postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --command="UPDATE \"Backup\" SET \"status\"='"'"'FAILED'"'"', \"errorMessage\"='"'"'Nonterminal metadata reconciled after restore'"'"', \"updatedAt\"=CURRENT_TIMESTAMP WHERE \"status\" IN ('"'"'PENDING'"'"','"'"'RUNNING'"'"','"'"'VERIFYING'"'"','"'"'RESTORING'"'"')"' sh "$TARGET_DATABASE"
fi
if [[ -n "$UPLOADS_TARGET" ]];then
  python3 "$SCRIPT_DIR/backup_archive.py" extract-uploads "$BACKUP_DIR" --target "$UPLOADS_TARGET" >/dev/null
fi
echo "Restore complete. Validate the isolated target before any production recovery decision."
BOUNDED_LEGACY_SQL
