# Per-parcel tracking notifications reuse communication delivery

Status: Accepted for local implementation, 2026-10-27. Production rollout remains separately authorized.

## Context and constraints

The same customer can have several orders and parcels, a different delivery email per order, and independent chat/SMTP outcomes. Reusing a client-wide text send alone cannot distinguish a repeat click from a new waybill or safely retry only a failed channel.

## Decision

Retain one confirmed notification per OrderShipment and trackingRevision, with independent channel records and immutable approved content. Reserve UUIDv4 message attempts before provider side effects through existing CommunicationsService/EmailTransportService; preserve Activity/AuditLog lineage. A successful result is authoritative even when Sent confirms it after an operator resolved an unknown outcome. Retry checks and reconciliation use the same conversation lock before replacing the request identity.

A database trigger versions carrier/number/verified URL changes across all existing writers, including imports; financial/status-only edits do not change the revision. Email captures the order recipient and confirmed mailbox identity without rebinding Client.email or the canonical email conversation. Historical Chatwoot records require authenticated conversation/inbox proof, not an inference from a generic channel enum; proof reads occur outside notification transactions.

## Consequences, migration and rollback

The migration is additive; existing documents, payments, messages and files are retained. Keeping the old communication-only path was simpler, but it could not retain parcel-specific consent or partial success. A broader queue/provider rewrite was rejected to preserve existing integration contracts.

No destructive down migration is provided: deleting delivery records would remove the duplicate-prevention evidence. A later application rollback must retain notification data and account for the new UPS carrier enum; once UPS records exist, verify the rollback API can deserialize them rather than relabelling historical parcels. No production migration, provider send, seed or restore was run for this implementation.

## Related

- [Implementation and audit](../plans/tracking-notifications.md)
- [Verification report](../release-evidence/tracking-notifications-2026-10-27.md)
