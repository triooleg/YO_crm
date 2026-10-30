# Backup and restore architecture

Current local extension: see [operator runbook](BACKUP_RECOVERY_RUNBOOK.md),
[implementation contract](plans/backup-disaster-recovery.md) and
[audit/real restore evidence](release-evidence/backup-recovery-audit-2026-10-26.md).
This feature is not deployed or enabled on production. The following core-format
details retain legacy v1/v2 compatibility; expanded portable snapshots use v3.

## Boundaries

- Application: Git commit plus versioned API/web images. Build cache, `node_modules` and container filesystems are disposable.
- Configuration: Compose files and non-secret defaults in `.env.example`; deployment-specific values live in the server `.env`.
- Secrets: server `.env` and encrypted integration settings. Secrets are never written to a backup manifest.
- Source-of-truth data: PostgreSQL and the uploads tree mounted at `/app/uploads`.
- Backup storage: host path configured by `BACKUP_STORAGE_PATH`, mounted at `/backups` in API.
- Rebuildable data: Redis, build output, caches, temporary files, logs, package caches and Docker layers.

The uploads tree currently contains order model images, task images and communication attachments. Future source documents, generated customer files, knowledge sources and durable AI memory must use a documented directory below `UPLOADS_DIR` or another explicitly registered persistent store.

## Core architecture

`BackupsModule` contains `BackupService`, `BackupRepository`, `BackupStorage`, `LocalBackupStorage`, `RestoreService` and scheduler/job contracts. CRM domain modules do not call `pg_dump`, `tar` or storage-specific commands.

Backward-compatible core admin API:

- `GET/POST /api/admin/backups`
- `GET /api/admin/backups/:id`
- `POST /api/admin/backups/:id/verify`
- `POST /api/admin/backups/:id/restore` (development verification/request boundary; execution remains CLI)
- `GET/PUT /api/admin/backups/settings`

Only OWNER and ADMIN may use these routes. Manual and scheduled requests share the `CreateBackupJob` boundary. No Docker socket is mounted into API.

## Create a backup

The manifest records the current Git checkout SHA when `.git` is available. A
deployed source archive has no `.git`, so the backup CLI falls back to validated
`.release-commit` and `.deployed-commit` markers. Each marker is accepted only
when it contains an exact 40-character SHA. When both markers are valid, they
must match; a valid conflict produces `unknown`. Otherwise a valid release
marker has priority, then a valid deployed marker. Invalid markers are ignored,
and no valid marker produces `unknown` instead of asserting uncertain
provenance.

```bash
export BACKUP_STORAGE_PATH=/srv/backups/yoleotard-crm
./scripts/backup.sh data
./scripts/backup.sh full
```

An API-created pending record can be completed by the same executor:

```bash
./scripts/backup.sh data --backup-id 20260829T030000Z-example1
```

Both types contain PostgreSQL custom-format `postgres.dump`, `uploads.tar.gz`, `manifest.json` and `SHA256SUMS`. Legacy FULL v2 declares compatibility metadata only. New verified-consistent FULL v3 adds a private source bundle, migrations/Compose/scripts, exact runtime image inventory and optional offline docker-save. No server .env is included. See the runbook for independent secrets and Chatwoot coverage.

COMPLETED is recorded only after checksum verification. Metadata records app version, Git commit, PostgreSQL version, latest applied Prisma migration, size, checksum, storage provider, timestamps and failure state. Copy completed directories to separate access-controlled storage. `BackupStorage` is the boundary for a later S3/R2/B2/MinIO adapter.

## Restore drill

Restore requires `ALLOW_RESTORE=true` and explicit `APP_ENV=backup-drill`, refuses the active/default production database, requires an existing empty isolated database and extracts files only to an empty isolated directory.

```bash
export APP_ENV=backup-drill ALLOW_RESTORE=true
export BACKUP_STORAGE_PATH=/srv/backups/yoleotard-crm
./scripts/restore.sh --backup-id 20260829T030000Z-example1 \
  --target-database yoleotard_crm_restore_drill \
  --uploads-target /srv/restore-drills/yoleotard-crm/uploads \
  --confirm "RESTORE yoleotard_crm_restore_drill"
```

Checksums and manifest version are validated before `pg_restore`. Absolute and parent-traversal archive paths are rejected before extraction.

## Automated development drill

The drill creates a representative DB row and persistent file, backs up, deletes both probes, restores to isolated targets and verifies both values:

```bash
BACKUP_RESTORE_INTEGRATION=true APP_ENV=backup-drill \
BACKUP_STORAGE_PATH=/tmp/yoleotard-crm-backup-test \
./scripts/backup-restore-test.sh
```

Run it only in a disposable development stack or Docker-enabled scheduled CI.

For an isolated Docker drill use `docker-compose.backup-test.yml`; it has a distinct Compose project, database and volumes and publishes no ports.

## Retention and scheduling

`BackupSetting` stores enabled, frequency, time, timezone, type, retention count and provider. The external host agent now executes durable requests and timezone-aware idempotent schedule slots under an exclusive host lock plus a cross-host PostgreSQL execution lease. It must be separately installed/enabled; no Docker socket is added to the API. `applyRetentionPolicy()` remains a dry-run projection; maintenance deletion requires explicit host-side configuration, verification/protected-copy rules and audit. Production activation remains unapproved.

Every new module must classify data as source-of-truth or rebuildable. Source filesystem data must live under an explicit persistent mount and join the manifest/restore drill. Derived indexes or embeddings may be excluded only when source documents and a deterministic rebuild procedure exist.
