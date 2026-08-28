#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
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
mkdir -p -- "$OUTPUT_DIR";OUTPUT_DIR="$(realpath --canonicalize-missing -- "$OUTPUT_DIR")";BACKUP_DIR="$OUTPUT_DIR/$BACKUP_ID";[[ ! -e "$BACKUP_DIR" ]]||{ echo "Backup already exists" >&2;exit 2; };mkdir -- "$BACKUP_DIR"
compose=(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE");backup_enum="${BACKUP_TYPE^^}"
psql_exec(){ "${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 "$@"' sh "$@"; }
update_failed(){ code=$?;psql_exec --command="UPDATE \"Backup\" SET \"status\"='FAILED',\"errorMessage\"='Backup CLI failed',\"updatedAt\"=CURRENT_TIMESTAMP WHERE \"id\"='$BACKUP_ID';" >/dev/null 2>&1||true;exit "$code"; };trap update_failed ERR
psql_exec --command="INSERT INTO \"Backup\"(\"id\",\"type\",\"status\",\"storageProvider\",\"storagePath\",\"startedAt\",\"createdAt\",\"updatedAt\",\"metadata\") VALUES('$BACKUP_ID','$backup_enum'::\"BackupType\",'RUNNING','LOCAL','$BACKUP_ID',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'{\"job\":\"CreateBackupJob\",\"requestedVia\":\"CLI\"}'::jsonb) ON CONFLICT(\"id\") DO UPDATE SET \"status\"='RUNNING',\"storagePath\"=EXCLUDED.\"storagePath\",\"startedAt\"=CURRENT_TIMESTAMP,\"errorMessage\"=NULL,\"updatedAt\"=CURRENT_TIMESTAMP;" >/dev/null
echo "Creating PostgreSQL custom dump...";"${compose[@]}" exec -T postgres sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' > "$BACKUP_DIR/postgres.dump"
echo "Archiving persistent uploads...";"${compose[@]}" exec -T api tar -C /app/uploads -czf - . > "$BACKUP_DIR/uploads.tar.gz"
APP_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json|head -n1)";GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null||echo unknown)"
SCHEMA_VERSION="$(psql_exec --tuples-only --no-align --command='SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY "finished_at" DESC LIMIT 1;'|tr -d '\r')";DATABASE_VERSION="$(psql_exec --tuples-only --no-align --command='SHOW server_version;'|tr -d '\r')"
[[ "$APP_VERSION" =~ ^[A-Za-z0-9._-]+$ && "$GIT_COMMIT" =~ ^([a-f0-9]{40}|unknown)$ && "$SCHEMA_VERSION" =~ ^[A-Za-z0-9._-]+$ && "$DATABASE_VERSION" =~ ^[A-Za-z0-9._ -]+$ ]]||{ echo "Unsafe version metadata" >&2;exit 1; }
(cd -- "$BACKUP_DIR"&&sha256sum postgres.dump uploads.tar.gz > SHA256SUMS);ARTIFACT_CHECKSUM="$(sha256sum "$BACKUP_DIR/SHA256SUMS"|cut -d' ' -f1)"
cat > "$BACKUP_DIR/manifest.json" <<JSON
{"format_version":2,"backup_id":"$BACKUP_ID","type":"$BACKUP_TYPE","created_at":"$STAMP","app_version":"$APP_VERSION","git_commit":"$GIT_COMMIT","schema_version":"$SCHEMA_VERSION","database_version":"$DATABASE_VERSION","storage_provider":"local","artifact_checksum":"$ARTIFACT_CHECKSUM","files":["postgres.dump","uploads.tar.gz"]}
JSON
(cd -- "$BACKUP_DIR"&&sha256sum manifest.json >> SHA256SUMS&&sha256sum --check SHA256SUMS)
MANIFEST_CHECKSUM="$(sha256sum "$BACKUP_DIR/manifest.json"|cut -d' ' -f1)";SIZE_BYTES="$(( $(stat -c %s "$BACKUP_DIR/postgres.dump")+$(stat -c %s "$BACKUP_DIR/uploads.tar.gz")+$(stat -c %s "$BACKUP_DIR/manifest.json")+$(stat -c %s "$BACKUP_DIR/SHA256SUMS") ))"
psql_exec --command="UPDATE \"Backup\" SET \"status\"='VERIFYING',\"updatedAt\"=CURRENT_TIMESTAMP WHERE \"id\"='$BACKUP_ID';UPDATE \"Backup\" SET \"status\"='COMPLETED',\"checksum\"='$MANIFEST_CHECKSUM',\"sizeBytes\"=$SIZE_BYTES::bigint,\"appVersion\"='$APP_VERSION',\"gitCommit\"='$GIT_COMMIT',\"databaseVersion\"='$DATABASE_VERSION',\"schemaVersion\"='$SCHEMA_VERSION',\"completedAt\"=CURRENT_TIMESTAMP,\"updatedAt\"=CURRENT_TIMESTAMP WHERE \"id\"='$BACKUP_ID';" >/dev/null
trap - ERR;echo "Backup complete: $BACKUP_ID ($BACKUP_TYPE)";echo "Storage: $BACKUP_DIR"
