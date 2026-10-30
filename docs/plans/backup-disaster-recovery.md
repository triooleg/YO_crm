# Backup and disaster recovery: implementation contract

Status: local implementation only; no deployment, production restore, service
stop, credential changes, commit or push authorized by this task.
Base: published `96fd65b`, CRM 0.10.0. Owner specification:
`YO_CRM_Backup_Disaster_Recovery_Codex_TZ.md`, 26 October 2026.

## Audit and coverage

The existing BackupsModule and scripts are the single backup system. Current
API creates a PENDING record but executes nothing; schedule is a pure function.
DATA captures a custom PostgreSQL dump and uploads sequentially, without a
cross-store consistency guarantee. FULL currently adds only compatibility
metadata. Local storage verification does not establish a restore proof.

| Component | Source of truth | DATA / FULL | Recovery proof |
| --- | --- | --- | --- |
| Orders, clients, athletes, immutable measurements, payments, taxes, history, tasks | PostgreSQL | Whole CRM DB | Table counts/fingerprints and relationship checks |
| Imported messages, provider identities, delivery attempts and webhook evidence | PostgreSQL | Existing local records | Counts; original provider history may be broader |
| Order/client/task/measurement files, invoice artifacts, local communication media | uploads persistent volume | Recursive files + file inventory | File count/bytes/digests and referenced-file checks |
| Remote Chatwoot/Meta attachments | Provider URL, not guaranteed local bytes | Explicitly external unless separately captured | Never report complete from URL pointers |
| Chatwoot self-hosted | Separate chatwood_postgres and storage | Optional separately configured component | Independent DB/media manifest and drill |
| Integration settings | Encrypted DB values | Ciphertext included | Original encryption key required separately |
| Runtime secrets, proxy/SSL | Server configuration | Excluded by default | Separate OWNER encrypted secret export/runbook |
| Application | Fixed source, migrations, Compose, exact image IDs | FULL portable application bundle; optional offline images | Compatibility and separate-project installation |
| Redis/cache | Rebuildable | Excluded | Isolated fresh Redis when application drill needs it |

Live read-only inventory confirmed separate CRM PostgreSQL/uploads/backups and
self-hosted Chatwoot 4.17.0. Host free space about16GiB; Docker/Node/Python/flock
available, restic/age absent. No host change performed. Workstation has no Docker.
Owner's temporary external destination is their workstation: implement authorized
download; do not claim download proves an offsite restore or configure S3.

## Architecture and sequence

1. Harden existing backup/restore contract; preserve legacy v1/v2 readers.
   Introduce v3 only for expanded portable composition and verified consistency.
2. Existing Backup rows form the durable queue. Metadata carries job kind,
   sourceBackupId, progress, retry/lease and results. No second job database.
3. External host recovery agent claims jobs under one exclusive lock, executes
   existing scripts, records progress/audit, reconciles abandoned jobs and
   generates idempotent timezone-aware schedule slots. No Docker socket in API.
4. Consistent backups require verified quiescence of writers; never silently
   label an online sequential dump/tar consistent. All writer stop/start actions
   require explicit installed agent configuration and a recovery journal.
5. Private directory archives and inventory survive loss of CRM DB. Uploads
   enter quarantine; no uploaded command, manifest or archive is executed.
6. Restic provides standard authenticated encryption for future external
   repositories; age supports a separately requested secret bundle. Missing
   tools/configuration is an explicit unavailable state, never success.
7. FULL packages source/Compose/migrations/scripts and pinned runtime inventory;
   offline mode additionally uses docker-save images. Installer restores into
   new project/storage only. No DNS, webhook, live recovery cutover or pruning
   of production data in this task.
8. UI uses Mantine and Russian i18n: archives, schedule, storage, verification,
   migration and journal; reauthentication for download/upload/drill/recovery
   plan. Production restore remains an external runbook/approved request only.

## API agreement (backward compatible)

Existing list/detail/settings/create/verify/restore routes remain. Add:

- GET `admin/backups/overview`: latestBackup, latestVerification, nextRun,
  totalSizeBytes, lastDrill, executor, offsite, coverage.
- POST create accepts optional idempotencyKey; returns existing Backup shape.
- POST `:id/download` with currentPassword streams archive, never a secret URL.
- POST `upload` multipart archive/currentPassword/type: quarantine and queue.
- POST `:id/drill` currentPassword: queue isolated check, never live restore.
- POST `:id/recovery-plan` currentPassword/confirmBackupId: audited safe plan.
- GET `journal`: bounded redacted backup/recovery events.
- Settings retain current fields; `recovery` adds weekly FULL, monthly drill,
  disabled-by-default retention/offsite, and explicit maintenance permission.

Backup.metadata.job.kind is BACKUP, IMPORT_VERIFY or DRILL. External worker is
the only executor; API never invokes Docker or restores a DB. Metadata must not
contain credentials. Download and upload are bounded and auditable.

## Test seams / acceptance

The owner-requested public seams are backup API with RBAC/reauth, actual archive
creation/validation/restore CLI and browser UI. Use red/green at those seams,
real files for storage validation and synthetic data for drills. Do not rely on
source-regex tests alone. Full quality plus existing backup architecture/contracts,
malicious archive matrix, scheduling/retry/concurrency, UI at desktop/mobile,
and a real isolated Docker-project restore are required. Drill must not start
workers or providers; network isolation independently prohibits egress.

No PITR claim: date selection means an existing snapshot. Current production
recovery, secret export, automatic retention execution, real provider sends,
offsite activation and DNS/integration switch require separate explicit scope.

## Development DAG

### Owner-approved workstation transfer extension

The latest instruction adds a MANUAL/AUTOMATIC selection for saving completed
archives to `D:\YO_CRM_Backups`. It supersedes the intermediate manual-only choice.
Manual remains the default. Automatic retrieval uses an explicitly paired Windows
helper while the user is logged in; the browser may be closed. The helper stores
a revocable archive-read credential using DPAPI, verifies streamed bytes and SHA256,
and never creates a second backup or deletes workstation archives. Server-side
backup creation remains the existing schedule. Current development does not install
the helper/task, change production settings or deploy. Device credentials expire
and stop working when revoked or when their administrator loses access. Source
reservations and retention claims must share an atomic enqueue/deletion protocol.

Audit -> compatibility scope review -> API / host-agent / UI (separate isolated
worktrees) -> INTEGRATOR -> regression/business/visual/Standards+Spec review ->
release gate. Integration is an uncommitted diff only. Existing working features
and archived business history are compatibility contracts.
