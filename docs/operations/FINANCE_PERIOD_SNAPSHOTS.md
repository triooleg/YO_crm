# Durable financial reports — 0.14.0

Candidate implementation, 2026-11-02. Installed acceptance is recorded separately
in the release evidence and canonical handoff. The owner authorized deployment
after completion; this document itself is not a deployment receipt.

## Storage and freshness

`FinanceReportRevision`, `FinancePeriodSnapshot` and `FinanceReportCacheRow`
contain derivative data only. The additive migration does not replace orders,
receipts, ledger entries, invoices, messages or files. All money calculations
still use the existing integer-minor-unit models. READY means a verified stored
projection, not that missing tax evidence has become complete.

Enabled ALWAYS row and TRUNCATE triggers cover 18 source tables, including
imports, workers, Prisma, direct SQL and replication-role writes. OLD and NEW
UTC/Kyiv periods, tax root graphs, allocation dependencies and historical FX
fallback windows are tracked in the source transaction. Relevant no-op updates
and ordinary inbox/client contact updates do not dirty financial periods.

Every hit checks a revision vector and the installed coverage manifest. Missing
keys, changed functions/tables, disabled triggers or unavailable cache storage
bypass durable results. Economic source failures remain errors. Administrative
DDL that temporarily disables triggers must be fenced and followed by cache
invalidation: re-enabling a trigger cannot prove which past writes it missed.

Historical complete and deterministic pending periods have no expiry. Transient
missing-provider evidence is stored as explicitly incomplete and retried after
30 seconds using compare-and-set expiration. New source evidence invalidates
immediately. Existing historical-provider retry/backoff rules still apply.

## Boundaries

- Finance monthly cash aggregates, fiscal deltas and raw tax read models are
  reused independently. Lifetime payment totals/last receipt use one SQL facts
  query; only changed months reread their cash detail. Cross-period tax lots and
  credit are recomposed from monthly inputs, never summed as independent credit.
- Current debt/forecast and clock-dependent projections retain their current
  business-day identity. A historical child remains reusable when this changes.
- Sales statistics has separate counts/financial namespaces. Personal client
  and drill queries use the existing path. Session, actor, permission and export
  tokens are never persisted. Each read creates a fresh actor/role/query-bound
  in-memory export receipt with the established 120-second lifetime.
- Existing MVCC raw-source cache, receipt SQL batching, request coalescing and
  stale-session/action guards remain intact. Redis is not needed for durable hits.
- Source capture uses one RepeatableRead transaction; child publication and
  provider calls run after it releases its connection. A one-connection pool is
  covered by the native integration test.

Cross-process leases select one calculator. Waiters observe the same artifact;
exhausted contention returns retryable 503 rather than launching a full duplicate
calculation. Publication rechecks dependencies under locks. Old owners cannot
overwrite new revisions. Summary checksums and complete SQL rowset manifests
bind pages/CSV to the exact verified summary.

## Tables and compatibility

Finance detail filtering, ordering and pagination run in PostgreSQL with ranks
derived from the established JavaScript ordering. Public CSV still limits the
filtered result to 50,000 rows; internal cache construction does not inherit that
export limit. Exports retain complete matching fiscal evidence.

The web adds `evidence=page`: only visible tax rows and expense valuation evidence
are transported. `evidenceProjection=page` marks this response, and the scalar
receipt-confirmation count remains authoritative. Omitted/`full` evidence keeps
the established full API response. Summary requests omit detail and share the
same in-flight request regardless of this detail-only flag. Coverage fallback
retains the original full calculation/transport contract.

No financial formula, payment mutation, agreed order price, fixed monthly ESV,
archive/void exclusion or tax recognition rule changes. Valuation-version and
current-rate freshness checks run even on hits. Unknown amounts remain null.

## Administration

Existing authenticated finance permissions continue to apply. OWNER/ADMIN only:

- `GET /finance/report/cache/diagnostics`: coverage, aggregate snapshot status
  counts and process counters, without customer/payment data.
- `POST /finance/report/cache/rebuild` with JSON `{"month":"YYYY-MM"}`: audited transaction bumps
  that month's cash/tax revisions and returns a recomputed summary. Business
  records are not edited. This is a bounded finance-period rebuild, not an
  unbounded history rewrite or a provider refresh.

Counters include hit/miss/invalidation, recalculated periods, elapsed report/cache
SQL time, SQL count, age and errors. `cache_revision` counts vector validations;
it is not an economic ledger revision. SQL metrics cover cache engine queries;
source/provider work must be measured separately through the integration harness
or request profiling. Counters restart with the API; stored projections do not.

Invalid artifacts can be discarded and rebuilt. Old revision artifacts are
derivatives, not business history; monitor their PostgreSQL size and include them
in the existing backup inventory. This change introduces no second backup engine
or automatic business-data retention job.

## Release/recovery

Schema 52 becomes 53 through one additive migration. Keep a fresh existing DATA
capture and isolated restore proof before cutover. Qualify rollback of the old
API/web on schema 53; do not restore a pre-release production database or remove
the migration journal as an ordinary application rollback. Verify the coverage
checker and ALWAYS trigger state after dump/restore as well as ordinary FK and
business fingerprints. Exact artifacts and final installed evidence belong in
the release report, not inferred from tags or this document.
