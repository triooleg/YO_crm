# Durable finance projections — implementation plan, 2026-11-02

Baseline: `369d61a`, installed application 0.13.4. Owner request is the
2026-11-02 persistent-finance-cache specification. Local implementation is
authorized. The owner subsequently explicitly authorized deployment after
completion, with the standing GitHub publication requirement. Production
migration/deployment still require completed exact-artifact release gates and
a fresh verified backup. Keep the installed version unchanged until then.

## Audit and boundaries

The existing ten-second MVCC raw-source cache, request coalescing, receipt
batching, RepeatableRead reads and historical FX evidence remain in place.
The report currently rereads lifetime payments/orders and recomputes both cash
and fiscal projections. Summary only removes detail after calculation.
Finance tables are order projections, not a list of individual receipts.

UTC legacy cash, Kyiv fiscal cash and source-event FX are different contracts.
Tax root corrections and allocations can affect earlier and later months.
Current debts/forecast are lifetime and business-day dependent. Global FOP KPI
must not acquire table-only source/customer filters. Null/pending is not zero.

## Sequence and owned changes

1. Preserve baseline JSON/CSV and source/query counters in a synthetic harness;
   compare identical inputs, not historical measurements from another release.
2. Add PostgreSQL revision rows and enabled-trigger coverage verification.
   Row triggers include OLD/NEW dates, workers/import/direct SQL; no-op writes
   and unrelated messages must not dirty finance. Unknown coverage bypasses.
3. Add `FinancePeriodSnapshot` and separate derivative rows, integrity checks,
   recoverable cross-process calculation leases and revision-checked publication.
4. Integrate bounded month reads and separate lifetime order-payment facts;
   reuse existing arithmetic and preserve complete fallback calculation.
5. Query derivative detail rows with SQL filters/paging, preserving established
   Russian numeric sort and stable null-last/ID ordering. Search/sort/page are
   never part of monthly aggregate identity; CSV uses the same verified version.
6. Keep web design/coordinator/auth transitions intact. Add freshness metadata
   only where useful. Retain existing export and pending-action guards.
7. Add OWNER/ADMIN diagnostics and audited bounded invalidation/rebuild; log only
   aggregate counters, revisions and timings, without customer/payment payloads.
8. Run differential/unit/isolated PostgreSQL/concurrency/browser/quality gates,
   then compatibility, regression, business, visual and release reviews.

DB work: schema, one additive migration, isolated database tests.
API work: finance cache/projection modules, existing report seam, diagnostics,
tests; tax readers only where required by proven dependencies.
Web work: existing finance/overview consumers and centralized i18n if needed.
Sales statistics has a separate actor-bound export receipt: never persist it in
shared cache or reuse it across sessions/roles. Extend only via its own seam.

## Risk controls

- Read revisions and source inputs in one RR transaction; recheck after external
  FX resolution. A slower calculation cannot publish under a newer revision.
- Coverage failure, corrupt payload or unavailable cache falls back to the
  existing calculation; database-source failure remains an error, never zero.
- Incomplete financial results keep missing evidence and receipt counts. A
  storage READY state is distinct from financial completeness.
- Fixed monthly ESV, integer minor-unit money, archive/void exclusions,
  immutable economic history and current formulas are compatibility contracts.
- No production migration, server change, new provider call or financial write
  is needed to validate the isolated implementation.

Implementation workers use isolated detached worktrees and uncommitted diffs;
the parent INTEGRATOR alone combines assigned paths. Final handoff records the
actual completion boundary and measured results rather than target promises.
