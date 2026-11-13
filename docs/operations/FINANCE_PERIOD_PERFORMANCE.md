# Persistent finance report measurements — 2026-11-02

Installed 0.14.0; exact artifacts and acceptance are recorded in
[the deployment report](../release-evidence/finance-period-cache-deployment-2026-11-03.md).
Method and operational boundaries: [FINANCE_PERIOD_SNAPSHOTS.md](FINANCE_PERIOD_SNAPSHOTS.md).

Actual production browser reload, November2026/EUR/range6: summary TTFB fell
from2676.613ms to98.692ms and detail from1815.387ms to70.422ms after warming.
The first summary construction took5494.509ms. These are individual browser
samples, not percentiles or isolated server processing time. The baseline shared
the host with isolated qualification; see the report for comparable query scope,
cold costs and the separate real-DATA shadow SQL measurements.

## Existing installed baseline, read only

The installed 0.13.4 tax reader was called for June–November in one explicit
RepeatableRead / `SET TRANSACTION READ ONLY` transaction, without bootstrapping
workers or calling providers: 77 SQL reads, 200 ms SQL time, 429 ms wall time.
The grouped payment `EXPLAIN (ANALYZE, BUFFERS)` read 485 rows with 121 shared
buffer hits, zero physical reads and 1.168 ms execution time. This did not
justify a new economic-source index. No production financial rows were changed.

## Isolated native PostgreSQL16 differential

The harness creates its own localhost-only database and applies all 53
migrations. It accepts installed binary paths, not a database URL or existing
data directory. The fixture uses synthetic orders, receipts across years,
Kyiv/UTC boundary expenses and three currencies. A proxy bypasses the new cache
to run the same authoritative full models. Complete JSON and filtered CSV are
compared, including debts, forecasts, sources, categories and fiscal evidence.

Final local run, including the review edge-case corrections:

| Operation | Wall ms | SQL calls | SQL ms |
|---|---:|---:|---:|
| Original full report | 180.63 | 55 | 16 |
| First durable calculation | 843.54 | 474 | 357 |
| Fresh API instance, durable hit | 26.19 | 23 | 9 |
| New November receipt, selective recomposition | 618.23 | 240 | 261 |
| First standalone tax range | 373.43 | 163 | 164 |
| Fresh tax service, durable hit | 25.31 | 6 | 11 |

These are synthetic measurements, not a promise of production latency. First
calculation costs more because it verifies coverage and stores reusable monthly
derivatives. A November receipt retained the exact September/October artifacts;
the integration and tax-input tests verify that their old receipt/expense detail
is not reread. Payment-date moves, voids, archive and historical FX changes
produce results identical to a fresh full calculation.

The final release evidence must identify the exact tested source and later
installed results; do not compare a production baseline with a synthetic hit as
if both used the same dataset. Private logs live under `.local/finance-periods`.

## Verification coverage

- Native whole-report/CSV parity, persisted instance restart, five concurrent
  callers, pool size one, UAH/EUR/USD, changed historical FX, detail filters,
  bounded evidence, corruption and disabled-trigger fallback.
- Standalone taxes and statistics use actual durable engine hits after instance
  restart without reading full economic source delegates. Export receipts remain
  bound to the newly authorized actor, role, query and expiration.
- Monthly tax raw inputs preserve cross-period lots, credit and fixed ESV; they
  are not treated as independently additive credit totals.
- SQL pagination has 193 comparisons against existing JavaScript sorting and
  filtering. Cache construction accepts 50,001 rows while public filtered CSV
  retains its established 50,000-row limit.
- Engine tests cover leases, revision races, failed acknowledgements, checksum
  and row-manifest corruption, SQL failure recovery and compare-and-set expiry.
- Same-instance missing/blocked statistics FX can recover after 30 seconds;
  complete sparse historical evidence retains its existing 30-minute memo.
- Eight real-browser fixture paths passed at 1920×1080, 1366×768 and 390px,
  including progressive loading, table-only refresh, debounce/action guards,
  error retry and logout/login session isolation. Six screenshots are retained
  privately under `.local/finance-perf`. This is local visual proof, not live UI
  acceptance. No page layout or financial formula was redesigned.

Quality and independent review totals belong to the final release report. Tests
which require optional credentials/native environments are explicitly skipped
unless their corresponding separate evidence exists.
