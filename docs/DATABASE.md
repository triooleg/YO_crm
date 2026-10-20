# Database conventions

- CUID primary keys and createdAt/updatedAt timestamps.
- Business entities use nullable archivedAt where history must remain.
- Client.inboxSpamAt is a nullable Inbox-only classification, independent of archivedAt/status. Existing clients default to NULL; setting/restoring it preserves conversations, messages and orders and records Activity/AuditLog. Provider ingestion does not clear the flag.
- Money uses integer minor units and a three-letter currency.
- Measurements are dated snapshots and never overwritten.
- Orders reference client, athlete and optional measurement snapshot.
- Sales, production, payment and shipping status remain separate.
- Production uses committed Prisma migrations and `prisma migrate deploy`.
