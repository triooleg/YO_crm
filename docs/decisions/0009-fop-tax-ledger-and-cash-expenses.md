---
status: accepted
---

# Dated FOP tax ledger alongside actual cash expenses

The owner approved local implementation, four additive tables and payment hooks
on 2026-10-19; deployment and production activation remain unauthorized. The owner
fixed the accounting start at 2026-05-01 inclusive and requires retries when a
historical rate is unavailable.

## Context

Payment stores original receipt economics and its existing order-currency
application. Expense represents actual cash spending, not a planned liability.
Order.taxMinor is an imported commercial field. Reusing any of these for FOP
accrual would change customer debt, duplicate expenses or reprice history when
rates or tax regimes change.

## Decision

Add TaxPolicy, TaxPeriod, TaxEntry and TaxExpenseAllocation. Keep receipt identity
and monthly component identity independent of policy versions to deduplicate
retries/imports. Append source, calculation and correction events; freeze closed
snapshots and retain subsequent corrections separately. Preserve existing payment,
production, invoice, shipment and audit contracts.

Value recognized foreign income in UAH at the dated official NBU rate. Preserve
exact decimal/rational evidence and integer minor units. A network failure leaves
a durable pending source and a scheduled retry for the original date. Never use
today's rate or a zero placeholder. Official minimum-wage bases are versioned by
validity date; missing future-year evidence is incomplete, not a copy of 2026.

Use one implicit FOP profile. Start with group3 5% without VAT, military levy1%,
monthly ESV22% of the official monthly minimum wage. Support dated future group2
rules without replacing used history. Fixed unified tax is monthly instead of a
receipt percentage. January1 statutory bases and the monthly ESV base are distinct.
Monthly obligations do not depend on the number of payments or visits to the UI.

Link actual tax payments to one unbound UAH Expense; allocate this cash separately
to liabilities. Unallocated money is credit. Preserve allocations that remain
valid after a downward correction, release only excess, and never count link and
allocation rows twice. Accrued and paid statistics stay separate from client debt.

## Consequences

Payment lifecycle hooks persist source evidence atomically with existing mutations;
external NBU calls run outside these transactions. Historical inclusion requires a
previewed explicit apply. Tax failures have isolated UI boundaries and do not blank
working finance data. Generic expense edits cannot bypass tax allocation history.

Disabling accrual does not remove existing tax-payment mutation guards. Once real
tax links exist, application rollback must retain a guard-aware API; an older API
that permits generic editing of linked Expense is not a compatible rollback.
Never drop the ledger or restore an older database to undo application code.

Activation, the production migration, historical apply on real data and deployment
remain separate operational actions. Automated bank payments, filing declarations,
VAT accounting and a multi-taxpayer subsystem are outside this decision.

## Tax-ledger identifier exception

The integrator documented this bounded implementation exception on 2026-10-19
within the owner-approved local tax-module scope. It was not a separate owner
decision about ID format. TaxPolicy, TaxPeriod, TaxEntry and TaxExpenseAllocation may use
application-generated UUID primary keys in the explicit Prisma SQL insert paths,
instead of the general CUID convention in docs/DATABASE.md. Prisma-created rows
may still use the declared CUID defaults. Both are opaque text identities; no
consumer may infer ordering, dates or business meaning from their format.
TaxEntry and TaxExpenseAllocation event order comes from sequence, not the ID.
Operation keys and source keys retain their separate deduplication semantics.

This exception preserves the existing immutable ledger identities. It authorizes
no ID rewrite, schema migration, change to other entity IDs, production action or
deployment. The general CUID convention continues to apply outside these four
tax-ledger tables.

## Evidence

[Official-source research](../research/fop-tax-accounting-2026-10-19.md) and
[approved plan](../plans/fop-tax-accounting.md). Implementation verification belongs
to the local evidence report; this ADR is not a claim that release gates passed.
