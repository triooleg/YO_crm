#!/usr/bin/env bash
set -Eeuo pipefail
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-yoleotard-crm}";COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.portainer.yml}";ENV_FILE="${ENV_FILE:-.env}";PRODUCTION_DATABASE="${PRODUCTION_DATABASE:-yoleotard_crm}"
BACKUP_DIR="";BACKUP_ID="";TARGET_DATABASE="";CONFIRM="";UPLOADS_TARGET=""
usage(){ echo "Usage: $0 (--backup-id ID|--backup-dir ABSOLUTE_DIRECTORY) --target-database NON_PRODUCTION_DATABASE --confirm 'RESTORE DATABASE' [--uploads-target ABSOLUTE_EMPTY_DIRECTORY]" >&2; }
while (($#));do case "$1" in --backup-id) BACKUP_ID="${2:-}";shift 2;;--backup-dir) BACKUP_DIR="${2:-}";shift 2;;--target-database) TARGET_DATABASE="${2:-}";shift 2;;--confirm) CONFIRM="${2:-}";shift 2;;--uploads-target) UPLOADS_TARGET="${2:-}";shift 2;;--compose-file) COMPOSE_FILE="${2:-}";shift 2;;--env-file) ENV_FILE="${2:-}";shift 2;;-h|--help) usage;exit 0;;*) echo "Unknown argument: $1" >&2;usage;exit 2;;esac;done
[[ "${ALLOW_RESTORE:-false}" == "true" ]]||{ echo "Restore is disabled; set ALLOW_RESTORE=true only for an isolated drill" >&2;exit 2; }
[[ "${APP_ENV:-}" == "backup-drill" ]] || { echo "CLI restore requires explicit APP_ENV=backup-drill" >&2; exit 2; }
if [[ -n "$BACKUP_ID" ]];then [[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$ ]]||exit 2;[[ -n "${BACKUP_STORAGE_PATH:-}" ]]||{ echo "BACKUP_STORAGE_PATH is required" >&2;exit 2; };BACKUP_DIR="${BACKUP_STORAGE_PATH%/}/$BACKUP_ID";fi
[[ "$BACKUP_DIR" = /* && -d "$BACKUP_DIR" ]]||{ echo "Backup directory must be an existing absolute directory" >&2;exit 2; };[[ "$TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]||exit 2;[[ "$TARGET_DATABASE" != "$PRODUCTION_DATABASE" ]]||{ echo "Refusing production database" >&2;exit 2; };[[ "$CONFIRM" == "RESTORE $TARGET_DATABASE" ]]||{ echo "Invalid confirmation" >&2;exit 2; }
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]||exit 1;command -v docker >/dev/null||exit 1;command -v sha256sum >/dev/null||exit 1
command -v node >/dev/null || { echo "node is required for strict manifest validation" >&2; exit 1; }
BACKUP_DIR="$(realpath --canonicalize-existing -- "$BACKUP_DIR")"
for file in postgres.dump uploads.tar.gz SHA256SUMS; do
  [[ -f "$BACKUP_DIR/$file" ]] || { echo "Missing $file" >&2; exit 1; }
done

if [[ -f "$BACKUP_DIR/manifest.json" ]]; then
  EXPECTED_BACKUP_ID="$BACKUP_ID" node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = process.env.EXPECTED_BACKUP_ID;
    if (manifest.format_version !== 2) throw new Error("unsupported format");
    if (expected && manifest.backup_id !== expected) throw new Error("backup id mismatch");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(manifest.backup_id || "")) throw new Error("invalid backup id");
    if (!["data", "full"].includes(manifest.type)) throw new Error("invalid backup type");
    if (manifest.storage_provider !== "local") throw new Error("invalid storage provider");
    if (JSON.stringify(manifest.files) !== JSON.stringify(["postgres.dump", "uploads.tar.gz"])) throw new Error("invalid artifact list");
  ' "$BACKUP_DIR/manifest.json" || { echo "Invalid v2 backup manifest" >&2; exit 1; }
elif [[ -f "$BACKUP_DIR/manifest.txt" ]]; then
  grep -qx 'format_version=1' "$BACKUP_DIR/manifest.txt" || {
    echo "Unsupported legacy backup manifest format" >&2
    exit 1
  }
  grep -qx 'compose_project=yoleotard-crm' "$BACKUP_DIR/manifest.txt" || {
    echo "Legacy backup project mismatch" >&2
    exit 1
  }
else
  echo "Missing manifest.json or legacy manifest.txt" >&2
  exit 1
fi

(cd -- "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
compose=(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE");ACTIVE_DATABASE="$("${compose[@]}" exec -T postgres printenv POSTGRES_DB|tr -d '\r')";[[ "$TARGET_DATABASE" != "$ACTIVE_DATABASE" ]]||{ echo "Refusing active database" >&2;exit 2; }
if [[ -n "$BACKUP_ID" ]]; then
  EXPECTED_METADATA="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator="|" --command="SELECT COALESCE(\"checksum\",'"'"''"'"') || '"'"'|'"'"' || COALESCE(\"sizeBytes\"::text,'"'"''"'"') FROM \"Backup\" WHERE \"id\"='"'"'$1'"'"' AND \"status\"='"'"'COMPLETED'"'"'"' sh "$BACKUP_ID" | tr -d '\r')"
  ACTUAL_CHECKSUM="$(sha256sum "$BACKUP_DIR/manifest.json" | cut -d' ' -f1)"
  ACTUAL_SIZE="$(( $(stat -c %s "$BACKUP_DIR/postgres.dump") + $(stat -c %s "$BACKUP_DIR/uploads.tar.gz") + $(stat -c %s "$BACKUP_DIR/manifest.json") + $(stat -c %s "$BACKUP_DIR/SHA256SUMS") ))"
  [[ "$EXPECTED_METADATA" == "$ACTUAL_CHECKSUM|$ACTUAL_SIZE" ]] || { echo "Backup artifacts do not match completed metadata" >&2; exit 1; }
fi
"${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '\''$1'\''"' sh "$TARGET_DATABASE"|grep -qx '1'||{ echo "Target database does not exist" >&2;exit 1; }
TARGET_TABLE_COUNT="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('"'"'pg_catalog'"'"','"'"'information_schema'"'"')"' sh "$TARGET_DATABASE" | tr -d '\r')"
[[ "$TARGET_TABLE_COUNT" == "0" ]] || { echo "Target database must be empty" >&2; exit 2; }
"${compose[@]}" exec -T postgres sh -c 'exec pg_restore --username="$POSTGRES_USER" --dbname="$1" --clean --if-exists --no-owner --exit-on-error' sh "$TARGET_DATABASE" < "$BACKUP_DIR/postgres.dump"
HAS_BACKUP_TABLE="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT to_regclass('"'"'public.\"Backup\"'"'"') IS NOT NULL"' sh "$TARGET_DATABASE" | tr -d '\r')"
if [[ "$HAS_BACKUP_TABLE" == "t" ]]; then
  "${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --set=ON_ERROR_STOP=1 --command="UPDATE \"Backup\" SET \"status\"='"'"'FAILED'"'"', \"errorMessage\"='"'"'Nonterminal metadata reconciled after restore'"'"', \"updatedAt\"=CURRENT_TIMESTAMP WHERE \"status\" IN ('"'"'PENDING'"'"','"'"'RUNNING'"'"','"'"'VERIFYING'"'"','"'"'RESTORING'"'"')"' sh "$TARGET_DATABASE"
fi
if [[ -n "$UPLOADS_TARGET" ]];then [[ "$UPLOADS_TARGET" = /* && "$UPLOADS_TARGET" != "/" ]]||exit 2;mkdir -p -- "$UPLOADS_TARGET";UPLOADS_TARGET="$(realpath --canonicalize-existing -- "$UPLOADS_TARGET")";[[ -z "$(find "$UPLOADS_TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]]||{ echo "Uploads target must be empty" >&2;exit 2; };if tar -tzf "$BACKUP_DIR/uploads.tar.gz"|grep -Eq '(^/|(^|/)\.\.(/|$))';then echo "Unsafe archive path" >&2;exit 1;fi;tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C "$UPLOADS_TARGET" --no-same-owner --no-same-permissions;fi
echo "Restore complete. Validate the isolated target before any production recovery decision."
