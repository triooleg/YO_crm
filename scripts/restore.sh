#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_PROJECT_NAME="yoleotard-crm"
COMPOSE_FILE="docker-compose.portainer.yml"
ENV_FILE=".env"
PRODUCTION_DATABASE="yoleotard_crm"

usage() {
  cat >&2 <<'USAGE'
Usage: restore.sh --backup-dir ABSOLUTE_DIRECTORY \
  --target-database NON_PRODUCTION_DATABASE \
  --confirm "RESTORE NON_PRODUCTION_DATABASE" \
  [--uploads-target ABSOLUTE_EMPTY_DIRECTORY] [--compose-file FILE] [--env-file FILE]
USAGE
}

BACKUP_DIR=""
TARGET_DATABASE=""
CONFIRM=""
UPLOADS_TARGET=""
while (($#)); do
  case "$1" in
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --target-database) TARGET_DATABASE="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --uploads-target) UPLOADS_TARGET="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[[ "$BACKUP_DIR" = /* && -d "$BACKUP_DIR" ]] || { echo "--backup-dir must be an existing absolute directory" >&2; exit 2; }
[[ "$TARGET_DATABASE" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "Invalid target database name" >&2; exit 2; }
[[ "$TARGET_DATABASE" != "$PRODUCTION_DATABASE" ]] || { echo "Refusing production database: $PRODUCTION_DATABASE" >&2; exit 2; }
[[ "$CONFIRM" == "RESTORE $TARGET_DATABASE" ]] || { echo "Confirmation must exactly equal: RESTORE $TARGET_DATABASE" >&2; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || { echo "$COMPOSE_FILE not found; run from the CRM root" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE not found; pass --env-file explicitly" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }

BACKUP_DIR="$(realpath --canonicalize-existing -- "$BACKUP_DIR")"
for file in postgres.dump uploads.tar.gz SHA256SUMS manifest.txt; do
  [[ -f "$BACKUP_DIR/$file" ]] || { echo "Missing backup artifact: $file" >&2; exit 1; }
done
grep -qx 'compose_project=yoleotard-crm' "$BACKUP_DIR/manifest.txt" || { echo "Backup manifest project mismatch" >&2; exit 1; }
(cd -- "$BACKUP_DIR" && sha256sum --check SHA256SUMS)

ACTIVE_DATABASE="$(docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres printenv POSTGRES_DB | tr -d '\r')"
[[ "$TARGET_DATABASE" != "$ACTIVE_DATABASE" ]] || { echo "Refusing active production database: $ACTIVE_DATABASE" >&2; exit 2; }

docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'exec psql --username="$POSTGRES_USER" --dbname=postgres --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname = '\''$1'\''"' sh "$TARGET_DATABASE" \
  | grep -qx '1' || { echo "Target database does not exist: $TARGET_DATABASE" >&2; exit 1; }

echo "Restoring database $TARGET_DATABASE..."
docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'exec pg_restore --username="$POSTGRES_USER" --dbname="$1" --clean --if-exists --no-owner --exit-on-error' sh "$TARGET_DATABASE" \
  < "$BACKUP_DIR/postgres.dump"

if [[ -n "$UPLOADS_TARGET" ]]; then
  [[ "$UPLOADS_TARGET" = /* && "$UPLOADS_TARGET" != "/" ]] || { echo "--uploads-target must be an absolute path other than /" >&2; exit 2; }
  mkdir -p -- "$UPLOADS_TARGET"
  UPLOADS_TARGET="$(realpath --canonicalize-existing -- "$UPLOADS_TARGET")"
  [[ -z "$(find "$UPLOADS_TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "Uploads target must be empty" >&2; exit 2; }
  if tar -tzf "$BACKUP_DIR/uploads.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    echo "Unsafe path found in uploads archive" >&2
    exit 1
  fi
  tar -xzf "$BACKUP_DIR/uploads.tar.gz" -C "$UPLOADS_TARGET" --no-same-owner --no-same-permissions
  echo "Uploads restored to isolated directory: $UPLOADS_TARGET"
fi

echo "Restore complete. Validate the isolated target before any production recovery decision."
