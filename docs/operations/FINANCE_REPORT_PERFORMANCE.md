# Financial report receipt lookup batching — 2026-11-01

Status: local candidate based on `097cb2f`; not deployed. No version bump,
schema migration, financial mutation or finished-report cache is included.

## Diagnosis

Authenticated production browser measurements over the local network:

| Path | Action | Total | Waiting for response |
| --- | --- | ---: | ---: |
| `/api/finance/report` | Overview reload | 4194 ms | 4179 ms |
| `/api/finance/report` | Switch to Finance | 4061 ms | 4060 ms |
| `/api/finance/exchange-rates/ensure-current` | Normal Finance navigation | 420 ms | — |

Most ordinary API requests in these samples took 24–728 ms. The report's
server-side calculation, rather than downloading the response, dominates this
delay. These timings describe the deployed baseline, not the candidate.

`FinanceReportService` reads a tax snapshot for each month. `TaxesService.reportIn`
previously queried the latest SOURCE and lifecycle event separately for every
payment root, plus individual retry and draft-adjustment lookups. The real
six-month sample contains 218 relevant payment roots: 436 receipt lookups plus
66 fixed reads, totalling 502 tax reads.

## Change and compatibility

The same snapshot now uses up to four bulk SELECTs per month for:

1. Latest SOURCE per payment root.
2. Latest lifecycle event per selected SOURCE.
3. Latest matching RESOLVE for each pending root/SOURCE pair.
4. Existence of an ADJUST reversing each DRAFT.

Lookup maps live only inside one report invocation and its existing transaction.
Command/write helpers, pending-state precedence, ledger sums, allocations,
archive exclusion, monthly fixed ESV, currencies and historical FX evidence are
unchanged. No new route, dependency, permission or public contract is introduced.

A cross-request cache of completed financial reports was deliberately avoided:
payments, voids, archived orders, expenses and background tax reconciliation can
change their results. Existing historical exchange-rate caching remains intact.

## Read-only production differential measurement

The installed legacy tax reader and compiled candidate were called in memory
against one PostgreSQL `RepeatableRead` transaction with
`SET TRANSACTION READ ONLY`, verified as `on`. This did not bootstrap Nest,
start workers, call providers, replace application files or deploy the candidate.
Only counts, elapsed times and result hashes were retained.

| Six-month tax read, June–November 2026 | Legacy | Candidate |
| --- | ---: | ---: |
| SQL queries | 502 | 76 |
| Database query duration | 1645 ms | 136 ms |
| Wall time | 2234 ms | 315 ms |

Both complete results have the same canonical SHA-256:
`92baa7d9a238184128280a88cba736e8bcd4731b11da226fe2429383b2406dce`.

This establishes approximately 7.1x faster tax reading for this sample and exact
result parity. It does not establish an installed `/api/finance/report` time:
ordinary finance reads, projection, FX and browser rendering remain outside this
isolated measurement. End-to-end candidate verification requires a separately
authorized deployment.

## Verification

The new four regression tests were written first and failed on the legacy
implementation (40 payments required 80 individual lookups). They now verify a
constant lookup budget for 1, 40 and 218 roots, latest-event and retry precedence,
DRAFT adjustments, immediate freshness on a second read and fixed monthly ESV
without payment roots. No financial rows are modified by these reads.

An independent synthetic in-memory PostgreSQL comparison also verifies all four
actual SQL selectors and ten full reports, including cross-period evidence,
retry/manual-review pairs, corrections and archived exclusions. The dense
fixture preserves complete output while reducing 476 reads to 15.

`pnpm quality:check` succeeds: API 2257 PASS/78 SKIP, web 800 PASS/27 SKIP,
database 28 PASS; typechecks and API/web builds pass. Optional environment tests
remain skipped rather than counted as executed. Independent role/review results
and the remaining installed validation boundary are recorded in `CHAT_HANDOFF.md`.
Private timing traces and synthetic SQL proof stay under ignored
`.local/finance-perf`; no customer payloads or credentials belong in this report.
