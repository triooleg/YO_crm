# Six finance loading improvements — 2026-11-02

Owner approved local implementation of all six improvements after installed
0.13.2. Base `fca28920`. No permission for this change's deployment, commits,
production DDL, restoration or financial mutation has been given.
Any later authorized release must deliver API and web together: the new web
consumer requires the additive summary projection understood by the new API.

## Contract

1. Share identical in-flight financial GETs between consumers using canonical
   query keys and role/session generations. Completed money responses always
   require an authorized server read; do not persist them in browser storage.
2. Keep presentation-only chart controls local. Paging/sorting/table filters
   load details without refreshing current exchange rates or hiding valid
   aggregate cards. Existing sequence guards prevent older responses winning.
3. Cache immutable database source snapshots, not completed financial results.
   Read PostgreSQL's complete MVCC snapshot token inside the same RepeatableRead
   transaction as its source queries. All committed writes make old source
   entries unreachable to new snapshots, including worker/import writes.
   Bound memory/lifetime; bypass unsupported snapshot reads and never cache
   SQL-unavailable fiscal reads. Known pending ledger rows remain reusable under
   the same MVCC guard; reconciliation commits invalidate them automatically.
   Recompute time/valuation/fiscal presentation per read. Limit retained source
   windows to eight entries and 16 MiB of estimated serialized UTF8 data for ten
   seconds; transient serialization/clones are not a hard process heap limit.
4. Add an optional summary projection to the existing guarded report route.
   Overview needs no transaction table. Finance shows aggregate data first,
   then requests full details. Replace complete responses rather than mixing
   filters, valuations or independently captured totals/rows. Omitted projection
   and exports preserve the existing full contract.
5. Review real EXPLAIN ANALYZE plans in a READ ONLY transaction. Add indexes only
   if measurements justify them; no production DDL is authorized.
6. Pause background badge polling while hidden, resume promptly, prevent overlap
   and back off failures. Preserve authentication checks and existing Inbox
   message transport; no new SSE service or infrastructure is necessary.

## Measurement and verification

Installed 0.13.2 browser report observations were 2530 ms (Overview) and 2019 ms
(Finance). They are the baseline, not proof of the uninstalled candidate.
Read-only plan audit: active orders 1.379 ms, active payments 2.286 ms, latest
tax sources 1.245 ms, latest lifecycle 24.636 ms; 29 relevant existing indexes.
Those four selected plans do not establish all report costs. No index change is
justified by this sample. Private plans contain no customer result rows.

Require test-first deduplication, cancelled observers, failures, session/role
separation, snapshot changes after all write classes, bounded cache eviction,
summary/full/export parity, progressive loading and polling visibility/backoff.
Run full quality checks and independent compatibility, regression, business,
visual and release reviews. Record browser acceptance separately from unit
proof. No production performance claim before an authorized deployment.

Snapshot semantics: [PostgreSQL snapshot functions](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-TXID-SNAPSHOT)
and [Repeatable Read](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-REPEATABLE-READ).
The cache strategy is a project design derived from those semantics, not an
external guarantee about YO CRM's performance.
