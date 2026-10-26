# Database conventions

- CUID primary keys and createdAt/updatedAt timestamps.
- Business entities use nullable archivedAt where history must remain.
- Client.inboxSpamAt is a nullable Inbox-only classification, independent of archivedAt/status. Existing clients default to NULL; setting/restoring it preserves conversations, messages and orders and records Activity/AuditLog. Provider ingestion does not clear the flag.
- Money uses integer minor units and a three-letter currency.
- Measurements are dated snapshots and never overwritten.
- Orders reference client, athlete and optional measurement snapshot.
- Sales, production, payment and shipping status remain separate.
- Production uses committed Prisma migrations and `prisma migrate deploy`.
- Client-facing invoices and generic order documents retain structured template
  and data snapshots. `DocumentTemplate` never stores executable HTML; generated
  fields are restricted to the API-owned allowlist.
- Template-only invoices retain their final authoritative order total, signed
  paid/balance projection, selected template revision and immutable content.
  Private `AppSetting` sections `invoice-previews`, `invoice-documents` and
  `invoice-idempotency` hold actor-scoped expiring proposals, frozen PDF/HTML
  artifacts and replay receipts. Ordinary finance settings never expose them.
  Invoice/artifact/replay/activity/audit writes commit in one transaction.
  Expired unsaved proposals are cleaned in bounded batches; saved artifacts and
  replay history are retained. Existing invoices are not rewritten and no
  schema migration is required for this additive workflow.
