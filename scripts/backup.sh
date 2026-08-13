#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_PROJECT_NAME="yoleotard-crm"
COMPOSE_FILE="docker-compose.portainer.yml"
ENV_FILE=".env"

usage() {
  echo "Usage: $0 --output-dir ABSOLUTE_DIRECTORY [--compose-file FILE] [--env-file FILE]" >&2
}

OUTPUT_DIR=""
while (($#)); do
  case "$1" in
    --output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[[ -n "$OUTPUT_DIR" ]] || { usage; exit 2; }
[[ "$OUTPUT_DIR" = /* && "$OUTPUT_DIR" != "/" ]] || {
  echo "--output-dir must be an absolute path other than /" >&2
  exit 2
}
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "$COMPOSE_FILE not found; run from the CRM root" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "$ENV_FILE not found; pass --env-file explicitly" >&2; exit 1; }

mkdir -p -- "$OUTPUT_DIR"
OUTPUT_DIR="$(realpath --canonicalize-missing -- "$OUTPUT_DIR")"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$OUTPUT_DIR/$STAMP"
mkdir -- "$BACKUP_DIR"

echo "Creating PostgreSQL custom dump..."
docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "$BACKUP_DIR/postgres.dump"

echo "Archiving uploads volume..."
docker compose --env-file "$ENV_FILE" -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" exec -T api \
  tar -C /app/uploads -czf - . > "$BACKUP_DIR/uploads.tar.gz"

(
  cd -- "$BACKUP_DIR"
  sha256sum postgres.dump uploads.tar.gz > SHA256SUMS
  {
    echo "format_version=1"
    echo "created_utc=$STAMP"
    echo "compose_project=$COMPOSE_PROJECT_NAME"
    echo "database_dump=postgres.dump"
    echo "uploads_archive=uploads.tar.gz"
  } > manifest.txt
)

echo "Backup complete: $BACKUP_DIR"
echo "Copy this directory to separate access-controlled storage."
