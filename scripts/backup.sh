#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# Each capture has a private process group so its watchdog can drain all children.
if [[ -z "${BACKUP_PROCESS_SESSION:-}" ]];then
  export BACKUP_PROCESS_SESSION=1
  exec setsid --wait bash "$0" "$@"
fi
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=backup-metadata.sh
. "$SCRIPT_DIR/backup-metadata.sh"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-yoleotard-crm}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.portainer.yml}"
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_TYPE="data"; OUTPUT_DIR="${BACKUP_STORAGE_PATH:-}"; BACKUP_ID=""
usage(){ echo "Usage: $0 [data|full] [--backup-id ID] [--output-dir ABSOLUTE_DIRECTORY] [--compose-file FILE] [--env-file FILE]" >&2; }
if [[ "${1:-}" =~ ^(data|full)$ ]];then BACKUP_TYPE="$1";shift;fi
while (($#));do case "$1" in --backup-id) BACKUP_ID="${2:-}";shift 2;;--output-dir) OUTPUT_DIR="${2:-}";shift 2;;--compose-file) COMPOSE_FILE="${2:-}";shift 2;;--env-file) ENV_FILE="${2:-}";shift 2;;-h|--help) usage;exit 0;;*) echo "Unknown argument: $1" >&2;usage;exit 2;;esac;done
[[ "$BACKUP_TYPE" =~ ^(data|full)$ ]]||{ echo "Backup type must be data or full" >&2;exit 2; }
[[ -n "$OUTPUT_DIR" ]]||{ echo "Set BACKUP_STORAGE_PATH or pass --output-dir" >&2;exit 2; }
[[ "$OUTPUT_DIR" = /* && "$OUTPUT_DIR" != "/" ]]||{ echo "Backup storage must be an absolute path other than /" >&2;exit 2; }
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]||{ echo "Compose or env file not found" >&2;exit 1; }
command -v docker >/dev/null||{ echo "docker is required" >&2;exit 1; };command -v sha256sum >/dev/null||{ echo "sha256sum is required" >&2;exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)";if [[ -z "$BACKUP_ID" ]];then BACKUP_ID="${STAMP}-$(od -An -N4 -tx1 /dev/urandom|tr -d ' \n')";fi
[[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]||{ echo "Invalid backup id" >&2;exit 2; }
mkdir -p -- "$OUTPUT_DIR";OUTPUT_DIR="$(realpath --canonicalize-missing -- "$OUTPUT_DIR")";BACKUP_DIR="$OUTPUT_DIR/$BACKUP_ID"
export BACKUP_STORAGE_PATH="$OUTPUT_DIR" COMPOSE_PROJECT_NAME COMPOSE_FILE ENV_FILE BACKUP_DATABASE_OVERRIDE
[[ -z "${BACKUP_DATABASE_OVERRIDE:-}" || "$BACKUP_DATABASE_OVERRIDE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || exit 2
. "$SCRIPT_DIR/backup-lock.sh"
JOURNAL="$OUTPUT_DIR/.quiescence.json"
command -v python3 >/dev/null || { echo "python3 is required" >&2;exit 1; }
resume_writers(){
  if [[ -e "$OUTPUT_DIR/.chatwoot-quiescence.json" ]];then python3 "$SCRIPT_DIR/backup_chatwoot.py" resume "$OUTPUT_DIR/.chatwoot-quiescence.json";fi
  python3 "$SCRIPT_DIR/backup_runtime.py" resume "$JOURNAL"
}
finish(){
  code=$?;trap - EXIT
  if ! resume_writers;then echo 'Writer resume failed: retained journal requires operator recovery' >&2;code=1;fi
  if [[ -n "${LEASE_WATCH_PID:-}" ]];then kill "$LEASE_WATCH_PID" 2>/dev/null||true;wait "$LEASE_WATCH_PID" 2>/dev/null||true;fi
  if [[ "${CLI_LEASE_ACQUIRED:-}" == 1 ]];then python3 "$SCRIPT_DIR/backup_runtime.py" lease-release "$BACKUP_ID" || code=1;fi
  exit "$code"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
[[ ! -e "$JOURNAL" ]] || { echo 'Unresolved quiescence journal; run backup_runtime.py resume first' >&2;exit 1; }
compose=(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE");backup_enum="${BACKUP_TYPE^^}"
psql_exec(){ "${compose[@]}" exec -T postgres sh -c 'database="${1:-$POSTGRES_DB}";shift;exec psql --username="$POSTGRES_USER" --dbname="$database" --set=ON_ERROR_STOP=1 "$@"' sh "${BACKUP_DATABASE_OVERRIDE:-}" "$@"; }
update_failed(){ code=$?;if [[ -z "${BACKUP_AGENT_JOB:-}" ]];then psql_exec --command="UPDATE \"Backup\" SET \"status\"='FAILED',\"errorMessage\"='Backup CLI failed',\"updatedAt\"=CURRENT_TIMESTAMP WHERE \"id\"='$BACKUP_ID' AND \"status\"='RUNNING' AND metadata#>>'{job,leaseOwner}'='${BACKUP_EXECUTION_OWNER:-}' AND EXISTS (SELECT 1 FROM \"AppSetting\" WHERE section='backups' AND key='execution-lease' AND value->>'owner'='${BACKUP_EXECUTION_OWNER:-}' AND (value->>'expiresAt')::timestamptz>CURRENT_TIMESTAMP);" >/dev/null 2>&1||true;fi;exit "$code"; };trap update_failed ERR
export BACKUP_TYPE
if [[ -z "${BACKUP_EXECUTION_OWNER:-}" ]];then
  export BACKUP_EXECUTION_OWNER="$(python3 -c 'import uuid;print(uuid.uuid4().hex)')"
  python3 "$SCRIPT_DIR/backup_runtime.py" lease-acquire "$BACKUP_ID"
  CLI_LEASE_ACQUIRED=1
fi
[[ ! -e "$BACKUP_DIR" ]] || { echo 'Backup already exists; refusing overwrite' >&2;exit 2; }
CLAIMED="$(python3 "$SCRIPT_DIR/backup_runtime.py" claim-cli "$BACKUP_ID")"
[[ "$CLAIMED" == "$BACKUP_ID" ]] || { echo 'Job is active/completed or owned by another executor' >&2;exit 2; }
export BACKUP_JOB_ID="$BACKUP_ID"
python3 "$SCRIPT_DIR/backup_runtime.py" lease-watch "$$" & LEASE_WATCH_PID=$!
mkdir -- "$BACKUP_DIR"

python3 "$SCRIPT_DIR/backup_runtime.py" space-preflight "$OUTPUT_DIR"
if [[ "${BACKUP_CONSISTENT:-false}" == "true" ]];then
  python3 "$SCRIPT_DIR/backup_runtime.py" quiesce "$JOURNAL"
fi
echo "Creating PostgreSQL custom dump...";"${compose[@]}" exec -T postgres sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="${1:-$POSTGRES_DB}" --format=custom' sh "${BACKUP_DATABASE_OVERRIDE:-}" > "$BACKUP_DIR/postgres.dump"
echo "Archiving persistent uploads...";if [[ "${BACKUP_CONSISTENT:-false}" == "true" ]];then
  python3 "$SCRIPT_DIR/backup_runtime.py" capture-uploads "$BACKUP_DIR/uploads.tar.gz"
else
  "${compose[@]}" exec -T api tar -C /app/uploads -czf - . > "$BACKUP_DIR/uploads.tar.gz"
fi
APP_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json|head -n1)";GIT_COMMIT="$(resolve_backup_git_commit "$(pwd)")"
SCHEMA_VERSION="$(psql_exec --tuples-only --no-align --command='SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY "finished_at" DESC LIMIT 1;'|tr -d '\r')";DATABASE_VERSION="$(psql_exec --tuples-only --no-align --command='SHOW server_version;'|tr -d '\r')"
case "$APP_VERSION:$SCHEMA_VERSION" in *[!A-Za-z0-9._:-]*|:) echo "Unsafe application or schema version" >&2;exit 1;;esac
[[ "$GIT_COMMIT" =~ ^([a-f0-9]{40}|unknown)$ && "$DATABASE_VERSION" =~ ^[0-9.]+$ ]]||{ echo "Unsafe Git or database version" >&2;exit 1; }
(cd -- "$BACKUP_DIR"&&sha256sum postgres.dump uploads.tar.gz > SHA256SUMS);ARTIFACT_CHECKSUM="$(sha256sum "$BACKUP_DIR/SHA256SUMS"|cut -d' ' -f1)"
cat > "$BACKUP_DIR/manifest.json" <<JSON
{"format_version":2,"backup_id":"$BACKUP_ID","type":"$BACKUP_TYPE","created_at":"$STAMP","app_version":"$APP_VERSION","git_commit":"$GIT_COMMIT","schema_version":"$SCHEMA_VERSION","database_version":"$DATABASE_VERSION","storage_provider":"local","artifact_checksum":"$ARTIFACT_CHECKSUM","files":["postgres.dump","uploads.tar.gz"]}
JSON
python3 "$SCRIPT_DIR/backup_runtime.py" finalize "$BACKUP_DIR" --journal "$JOURNAL"
python3 "$SCRIPT_DIR/backup_archive.py" pack "$BACKUP_DIR" > "$OUTPUT_DIR/.last-validation.json"
(cd -- "$BACKUP_DIR"&&sha256sum --check SHA256SUMS)
resume_writers
MANIFEST_CHECKSUM="$(sha256sum "$BACKUP_DIR/manifest.json"|cut -d' ' -f1)";SIZE_BYTES="$(( $(stat -c %s "$BACKUP_DIR/postgres.dump")+$(stat -c %s "$BACKUP_DIR/uploads.tar.gz")+$(stat -c %s "$BACKUP_DIR/manifest.json")+$(stat -c %s "$BACKUP_DIR/SHA256SUMS") ))"
SIZE_BYTES="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sizeBytes"])' "$OUTPUT_DIR/.last-validation.json")"
if [[ -z "${BACKUP_AGENT_JOB:-}" ]];then
  python3 "$SCRIPT_DIR/backup_runtime.py" complete-cli "$BACKUP_DIR"
fi
trap - ERR;echo "Backup complete: $BACKUP_ID ($BACKUP_TYPE)";echo "Storage: $BACKUP_DIR"
