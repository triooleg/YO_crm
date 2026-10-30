# ADR 0012: extend the backup platform through an external recovery agent

Date: 2026-10-26. Status: accepted for local implementation; activation pending
separate production authorization.

## Context

BackupsModule owns requests, metadata, authorization and storage verification.
The existing backup/restore CLI owns PostgreSQL and persistent files. Giving the
web API Docker control would enlarge the application compromise boundary.
Sequential live dump/tar is not proof of cross-store consistency, and CRM
message rows are not a backup of a separate provider database or remote media.

## Decision

Retain those owners. A separately installed host agent executes the existing
scripts and uses existing Backup records for its durable queue. New job details
live in namespaced metadata; it does not introduce a second backup registry.
Manifests and inventory outside the CRM DB permit recovery if that DB is lost.
Version3 describes expanded composition; legacy readers remain available.

The agent must serialize backup, import, drill and retention, recover abandoned
work explicitly and record verifiable results. A consistency claim requires a
verified write barrier/quiescence. Writer stoppage requires explicit installed
configuration and must be journalled for resumption after failure. No web API
container gets a Docker socket. Host execution rights are privileged and must
be restricted to the deployment account and configured project/resources.

External repositories use standard authenticated encryption through restic,
with credentials supplied outside the archive and outside public metadata.
Secret bundles are separate opt-in age exports; ordinary exports never include
the server .env. Encrypted settings in a DB dump still require the original
SETTINGS_ENCRYPTION_KEY, which must be preserved separately.

The initial external destination is manual download to the owner's workstation.
A successful download is neither verified offsite storage nor a restore proof.
The interface exposes those as distinct states. Actual S3/second-host activation,
secret export and retention execution are not inferred from UI configuration.

Restore and installation write into new empty DB/storage targets. The current
production restore endpoint remains prohibited; recovery-plan requests are
audited planning only. Production cutover, emergency backup, traffic freeze,
rollback and integration reactivation require a separately approved operation.
Drill uses an internal network and explicit runtime isolation, without provider
workers; it never uses production volumes, credentials or webhooks.

## Consequences

The owner can export portable data and application bundles without extending
domain modules with infrastructure commands. The host agent and its tools must
be installed before queued jobs can execute. Unknown/missing external components,
decryption keys, image availability or consistency evidence remain visible
limitations rather than a green “complete backup” status. No PITR is claimed.

## References

- https://www.postgresql.org/docs/16/backup-dump.html
- https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- https://docs.docker.com/reference/compose-file/networks/
- docs/plans/backup-disaster-recovery.md
