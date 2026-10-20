# ADR0010: Direct-canonical website checkout identity

Status: implemented in local RC; rollout requires the separate CheckoutV2 handoff.
Date: 2026-10-20. Supersedes the earlier uninstalled taxless candidate's
conditional cross-provider conflict-only proposal, not installed order history.

## Context

Checkout may deliver both to KeyCRM and directly to YO CRM. Client/day/amount
matching cannot identify a business order. KeyCRM source IDs and website IDs
belong to different namespaces, and providers may disagree about fee totals.
Reusing a paid/root order or manually managed record would risk duplicate income,
rewritten tax evidence and loss of operator changes.

## Decision

The stable identity is (canonical sourceAccount, canonicalCheckoutId), represented
in KeyCRM as yo-checkout:v1:<account>:<id>. One shared pure formatter validates
both interfaces. Canonical ID is positive decimal1–20 digits; line and receipt IDs
are opaque, persistently scoped with a JSON tuple. Secrets/PII are not identifiers.

The direct endpoint is the canonical CRM Order/Payment writer. Reserved-marked
KeyCRM records ALWAYS hold before legacy lookup/freshness/fuzzy/financial writes,
including when direct has not arrived. Hold provenance retains exact provider
payload privately and refers to the canonical Order ID when available; issues()
redacts the raw payload. Direct-first, KeyCRM-first and concurrent arrivals leave
one business order/receipt, without alias adoption or provider history rewriting.

Opted-in connection/source/account/time cohorts hold missing/mismatched markers;
invalid configuration/malformed reserved markers fail closed. Old/unmapped legacy
imports retain existing behavior. Direct orders cannot be fuzzy-adopted by legacy
imports. There is no timeout fallback to creating a second order.

Direct paid receipt creation invokes the installed mandatory native tax capture
inside the same transaction/order lock. Existing group3 ROOT/SOURCE pairs,
immutable histories, dated FX cache, manual receipt confirmation and closed-period
rules remain authoritative. Fee revenue is included in the fixed gross charge;
there is no fee tax component and no double addition. Unpaid bank creates no
Payment/receipt tax entries. No tax implementation or schema change is needed.

## Consequences

The plugin must persist canonical ownership and a durable direct outbox BEFORE
external writes, retaining account/order/line/receipt identities through retries,
draft continuation and provider fallback. Reserved markers are restricted to
that direct-authoritative cohort. KeyCRM-only traffic must not be silently
converted to a permanently held direct cohort. Held records are visible as sync
issues and require outbox recovery or explicit operator reconciliation.

Legacy records and collisions already in the database are not auto-adopted,
merged, backfilled or deleted. Rollback must pause both channels/importers before
running an older API that lacks this guard. Production activation remains a
separate approved operation with a fresh source/image inventory and FULL backup.

## Verification

Actual Nest/current validation and PostgreSQL16/schema43 tests cover first-POST
concurrency, both channel orders, two simultaneous database lock waiters,
unpaid→paid/replay, distinct same-client orders, private error/log behavior and
DB-trigger rollback at Payment/TaxEntry/AuditLog. See the RC report and
`docs/integrations/checkout-v518-source-uuid-handoff.md` for exact boundaries.
