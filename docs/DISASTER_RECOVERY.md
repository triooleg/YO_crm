# Disaster recovery runbook

Application code is recovered from a known Git commit/versioned image. Business data is recovered independently from a verified backup. Restoring data must not require code rollback unless manifest schema compatibility requires it.

## Before production launch

1. Configure backup storage on a different disk where possible.
2. Add off-server S3/R2/B2/MinIO replication or a reviewed transfer job.
3. Record quarterly restore drills and drills before schema-risk releases.
4. Define RPO/RTO and retention; initial recommendation is 7 daily, 4 weekly and 6 monthly.
5. Enable only a single-leader scheduler/worker with locking and alerts.

## Full recovery

1. Preserve evidence and verify manifest/checksums/version/schema.
2. Create a fresh safety backup if the damaged state is readable.
3. Enter maintenance mode and stop writers.
4. Provision new PostgreSQL and empty uploads targets.
5. Restore and validate in isolation first.
6. Validate clients, conversations, orders, payments, audit history and sample files.
7. Deploy the compatible commit/image and only committed migrations.
8. Run health and operator smoke checks before switching traffic.
9. Record restore started/completed/failed audit events and retain incident evidence.

The development API never performs production restore. `ALLOW_RESTORE` and `APP_ENV` deliberately keep production recovery an explicit reviewed server operation.
