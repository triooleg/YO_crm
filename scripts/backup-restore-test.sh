#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${BACKUP_RESTORE_INTEGRATION:-false}" == "true" ]]||{ echo "Set BACKUP_RESTORE_INTEGRATION=true" >&2;exit 2; }
[[ "${APP_ENV:-}" == "backup-drill" ]] || { echo "Set APP_ENV=backup-drill explicitly" >&2; exit 2; }
export ALLOW_RESTORE=true;export BACKUP_STORAGE_PATH="${BACKUP_STORAGE_PATH:-/tmp/yoleotard-crm-backup-test}";TARGET_DATABASE="${TARGET_DATABASE:-yoleotard_crm_restore_test}";UPLOADS_TARGET="${UPLOADS_TARGET:-/tmp/yoleotard-crm-restore-files}"
compose=(docker compose --env-file "${ENV_FILE:-.env}" -p "${COMPOSE_PROJECT_NAME:-yoleotard-crm}" -f "${COMPOSE_FILE:-docker-compose.yml}");PROBE="backup-restore-$(date -u +%s)-$$";CREATED_TARGET=false;CREATED_LEGACY=false;CREATED_UPLOADS=false;CREATED_LEGACY_UPLOADS=false;BACKUP_ID="";LEGACY_DIR=""
ACTIVE_DATABASE="$("${compose[@]}" exec -T postgres printenv POSTGRES_DB|tr -d '\r')";[[ "$TARGET_DATABASE" != "$ACTIVE_DATABASE" && "$TARGET_DATABASE" != "yoleotard_crm" ]]||{ echo "Unsafe drill target" >&2;exit 2; }
EXISTS="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname=postgres --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname='"'"'$1'"'"'"' sh "$TARGET_DATABASE"|tr -d '\r')";[[ -z "$EXISTS" ]]||{ echo "Drill target already exists" >&2;exit 2; }
[[ "$BACKUP_STORAGE_PATH" = /* && "$BACKUP_STORAGE_PATH" != "/" && "$UPLOADS_TARGET" = /* && "$UPLOADS_TARGET" != "/" ]]||{ echo "Unsafe drill paths" >&2;exit 2; }
[[ ! -e "$UPLOADS_TARGET" && ! -e "${UPLOADS_TARGET}-legacy" ]]||{ echo "Drill output paths must not exist" >&2;exit 2; }
cleanup(){ if [[ "$CREATED_TARGET" == true ]];then "${compose[@]}" exec -T postgres sh -c 'dropdb --username="$POSTGRES_USER" --if-exists "$1"' sh "$TARGET_DATABASE" >/dev/null 2>&1||true;fi;if [[ "$CREATED_LEGACY" == true ]];then "${compose[@]}" exec -T postgres sh -c 'dropdb --username="$POSTGRES_USER" --if-exists "$1"' sh "${TARGET_DATABASE}_legacy" >/dev/null 2>&1||true;fi;if [[ -n "$BACKUP_ID" ]];then "${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command="DELETE FROM \"Backup\" WHERE \"id\"='"'"'$1'"'"'"' sh "$BACKUP_ID" >/dev/null 2>&1||true;fi;"${compose[@]}" exec -T api rm -f "/app/uploads/backup-restore-probe/$PROBE.txt" >/dev/null 2>&1||true;if [[ "$CREATED_UPLOADS" == true ]];then rm -rf -- "$UPLOADS_TARGET";fi;if [[ "$CREATED_LEGACY_UPLOADS" == true ]];then rm -rf -- "${UPLOADS_TARGET}-legacy";fi;if [[ -n "$BACKUP_ID" && -d "$BACKUP_STORAGE_PATH/$BACKUP_ID" ]];then rm -rf -- "$BACKUP_STORAGE_PATH/$BACKUP_ID";fi;if [[ -n "$LEGACY_DIR" && -d "$LEGACY_DIR" ]];then rm -rf -- "$LEGACY_DIR";fi; };trap cleanup EXIT
"${compose[@]}" exec -T api sh -c 'mkdir -p /app/uploads/backup-restore-probe;printf "%s" "$1" >"/app/uploads/backup-restore-probe/$1.txt"' sh "$PROBE"
OUTPUT="$(./scripts/backup.sh data --output-dir "$BACKUP_STORAGE_PATH" --compose-file "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env}")";BACKUP_ID="$(printf '%s\n' "$OUTPUT"|sed -n 's/^Backup complete: \([^ ]*\).*/\1/p')";[[ -n "$BACKUP_ID" ]]||exit 1
"${compose[@]}" exec -T api rm -f "/app/uploads/backup-restore-probe/$PROBE.txt";"${compose[@]}" exec -T postgres sh -c 'createdb --username="$POSTGRES_USER" "$1"' sh "$TARGET_DATABASE";CREATED_TARGET=true;mkdir "$UPLOADS_TARGET";CREATED_UPLOADS=true
./scripts/restore.sh --backup-id "$BACKUP_ID" --target-database "$TARGET_DATABASE" --uploads-target "$UPLOADS_TARGET" --confirm "RESTORE $TARGET_DATABASE" --compose-file "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env}"
DB_VALUE="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT \"id\" FROM \"Backup\" WHERE \"id\"='"'"'$2'"'"'"' sh "$TARGET_DATABASE" "$BACKUP_ID"|tr -d '\r')";FILE_VALUE="$(cat "$UPLOADS_TARGET/backup-restore-probe/$PROBE.txt")";[[ "$DB_VALUE" == "$BACKUP_ID" && "$FILE_VALUE" == "$PROBE" ]]||{ echo "Restore verification failed" >&2;exit 1; }

# Exercise the legacy v1 artifact contract used by backups created before the platform module.
LEGACY_DIR="${BACKUP_STORAGE_PATH%/}/${BACKUP_ID}-legacy";LEGACY_DATABASE="${TARGET_DATABASE}_legacy";LEGACY_UPLOADS="${UPLOADS_TARGET}-legacy"
mkdir -- "$LEGACY_DIR";cp "$BACKUP_STORAGE_PATH/$BACKUP_ID/postgres.dump" "$BACKUP_STORAGE_PATH/$BACKUP_ID/uploads.tar.gz" "$LEGACY_DIR/"
(cd "$LEGACY_DIR"&&sha256sum postgres.dump uploads.tar.gz > SHA256SUMS)
cat > "$LEGACY_DIR/manifest.txt" <<EOF
format_version=1
created_utc=$(date -u +%Y%m%dT%H%M%SZ)
compose_project=yoleotard-crm
database_dump=postgres.dump
uploads_archive=uploads.tar.gz
EOF
"${compose[@]}" exec -T postgres sh -c 'createdb --username="$POSTGRES_USER" "$1"' sh "$LEGACY_DATABASE";CREATED_LEGACY=true;mkdir "$LEGACY_UPLOADS";CREATED_LEGACY_UPLOADS=true
./scripts/restore.sh --backup-dir "$LEGACY_DIR" --target-database "$LEGACY_DATABASE" --uploads-target "$LEGACY_UPLOADS" --confirm "RESTORE $LEGACY_DATABASE" --compose-file "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env}"
LEGACY_DB_VALUE="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT \"id\" FROM \"Backup\" WHERE \"id\"='"'"'$2'"'"'"' sh "$LEGACY_DATABASE" "$BACKUP_ID"|tr -d '\r')"
[[ "$LEGACY_DB_VALUE" == "$BACKUP_ID" && "$(cat "$LEGACY_UPLOADS/backup-restore-probe/$PROBE.txt")" == "$PROBE" ]]||{ echo "Legacy restore verification failed" >&2;exit 1; }
"${compose[@]}" exec -T postgres sh -c 'dropdb --username="$POSTGRES_USER" --if-exists "$1"' sh "$LEGACY_DATABASE";CREATED_LEGACY=false
echo "Restore integration verify PASS: v2 and legacy v1 database and persistent files"
