#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${BACKUP_RESTORE_INTEGRATION:-false}" == "true" ]]||{ echo "Set BACKUP_RESTORE_INTEGRATION=true" >&2;exit 2; };[[ "${APP_ENV:-development}" != "production" ]]||exit 2
export ALLOW_RESTORE=true;export BACKUP_STORAGE_PATH="${BACKUP_STORAGE_PATH:-/tmp/yoleotard-crm-backup-test}";TARGET_DATABASE="${TARGET_DATABASE:-yoleotard_crm_restore_test}";UPLOADS_TARGET="${UPLOADS_TARGET:-/tmp/yoleotard-crm-restore-files}"
compose=(docker compose --env-file "${ENV_FILE:-.env}" -p "${COMPOSE_PROJECT_NAME:-yoleotard-crm}" -f "${COMPOSE_FILE:-docker-compose.yml}");PROBE="backup-restore-$(date -u +%s)"
cleanup(){ "${compose[@]}" exec -T postgres sh -c 'dropdb --username="$POSTGRES_USER" --if-exists "$1"' sh "$TARGET_DATABASE" >/dev/null 2>&1||true; };trap cleanup EXIT
"${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1' <<SQL
CREATE TABLE IF NOT EXISTS backup_restore_probe(id text PRIMARY KEY);INSERT INTO backup_restore_probe(id) VALUES('$PROBE');
SQL
"${compose[@]}" exec -T api sh -c 'mkdir -p /app/uploads/backup-restore-probe;printf "%s" "$1" >/app/uploads/backup-restore-probe/probe.txt' sh "$PROBE"
OUTPUT="$(./scripts/backup.sh data --output-dir "$BACKUP_STORAGE_PATH" --compose-file "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env}")";BACKUP_ID="$(printf '%s\n' "$OUTPUT"|sed -n 's/^Backup complete: \([^ ]*\).*/\1/p')";[[ -n "$BACKUP_ID" ]]||exit 1
"${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --set=ON_ERROR_STOP=1' <<SQL
DELETE FROM backup_restore_probe WHERE id='$PROBE';
SQL
"${compose[@]}" exec -T api rm -f /app/uploads/backup-restore-probe/probe.txt;"${compose[@]}" exec -T postgres sh -c 'createdb --username="$POSTGRES_USER" "$1"' sh "$TARGET_DATABASE";mkdir -p "$UPLOADS_TARGET";[[ -z "$(find "$UPLOADS_TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]]||exit 2
./scripts/restore.sh --backup-id "$BACKUP_ID" --target-database "$TARGET_DATABASE" --uploads-target "$UPLOADS_TARGET" --confirm "RESTORE $TARGET_DATABASE" --compose-file "${COMPOSE_FILE:-docker-compose.yml}" --env-file "${ENV_FILE:-.env}"
DB_VALUE="$("${compose[@]}" exec -T postgres sh -c 'exec psql --username="$POSTGRES_USER" --dbname="$1" --tuples-only --no-align --command="SELECT id FROM backup_restore_probe LIMIT 1"' sh "$TARGET_DATABASE"|tr -d '\r')";FILE_VALUE="$(cat "$UPLOADS_TARGET/backup-restore-probe/probe.txt")";[[ "$DB_VALUE" == "$PROBE" && "$FILE_VALUE" == "$PROBE" ]]||{ echo "Restore verification failed" >&2;exit 1; };echo "Restore integration verify PASS: database and persistent file"
