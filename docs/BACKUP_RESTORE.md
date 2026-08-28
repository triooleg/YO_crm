# Backup and restore architecture

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

Future admin UI API:

- `GET/POST /api/admin/backups`
- `GET /api/admin/backups/:id`
- `POST /api/admin/backups/:id/verify`
- `POST /api/admin/backups/:id/restore` (development verification/request boundary; execution remains CLI)
- `GET/PUT /api/admin/backups/settings`

Only OWNER and ADMIN may use these routes. Manual and scheduled requests share the `CreateBackupJob` boundary. No Docker socket is mounted into API.

## Create a backup

```bash
export BACKUP_STORAGE_PATH=/srv/backups/yoleotard-crm
./scripts/backup.sh data
./scripts/backup.sh full
```

An API-created pending record can be completed by the same executor:

```bash
./scripts/backup.sh data --backup-id 20260829T030000Z-example1
```

Both types contain PostgreSQL custom-format `postgres.dump`, `uploads.tar.gz`, `manifest.json` and `SHA256SUMS`. FULL declares application compatibility metadata; application binaries come from Git/versioned images rather than copying `node_modules` or container layers.

COMPLETED is recorded only after checksum verification. Metadata records app version, Git commit, PostgreSQL version, latest applied Prisma migration, size, checksum, storage provider, timestamps and failure state. Copy completed directories to separate access-controlled storage. `BackupStorage` is the boundary for a later S3/R2/B2/MinIO adapter.

## Restore drill

Restore requires `ALLOW_RESTORE=true`, refuses `APP_ENV=production`, refuses the active/default production database, requires an existing isolated database and extracts files only to an empty isolated directory.

```bash
export APP_ENV=development ALLOW_RESTORE=true
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
BACKUP_RESTORE_INTEGRATION=true APP_ENV=development \
BACKUP_STORAGE_PATH=/tmp/yoleotard-crm-backup-test \
./scripts/backup-restore-test.sh
```

Run it only in a disposable development stack or Docker-enabled scheduled CI.

For an isolated Docker drill use `docker-compose.backup-test.yml`; it has a distinct Compose project, database and volumes and publishes no ports.

## Retention and scheduling

`BackupSetting` stores enabled, frequency, time, timezone, type, retention count and provider. `BackupScheduler.isDue()` is a pure boundary; production scheduling stays disabled until a worker/lease prevents concurrent jobs. `applyRetentionPolicy(false)` reports candidates without deletion. Physical cleanup is an explicit internal execution and archives metadata after storage deletion.

Every new module must classify data as source-of-truth or rebuildable. Source filesystem data must live under an explicit persistent mount and join the manifest/restore drill. Derived indexes or embeddings may be excluded only when source documents and a deterministic rebuild procedure exist.
