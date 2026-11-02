# Finance loading — six improvements, 2026-11-02

Implementation based on `fca28920`, branch `codex/finance-loading-optimization`.
Owner subsequently authorized deployment and source publication as 0.13.3.
Production baseline is the previously accepted 0.13.2 until reviewed cutover.
API and web must ship together. No database migration, index DDL or financial
mutation is included. Installed release evidence is recorded separately after
deployment; local acceptance below does not by itself establish installed proof.

## Delivered behavior

| Improvement | Implementation |
| --- | --- |
| Repeated requests | Canonical financial GET keys share in-flight work across Overview/Finance consumers. Responses are independently consumable; cancelling one observer does not cancel another. Completed money responses always require a new server read. |
| Partial updates | Presentation-only chart controls remain local. Table paging, sorting and search skip summary and exchange-rate refresh. Search debounces 250 ms. Pending filters immediately block old row actions and export. Old amounts are not displayed under a newly selected aggregate currency/period/source. |
| Safe caching | A bounded cache reuses immutable raw database inputs only when the complete MVCC snapshot matches inside the existing RepeatableRead transaction. All financial calculations and valuation checks run again. Worker/import/direct-write commits change the snapshot, without relying on an incomplete write-hook list. |
| Progressive loading | Overview requests the summary projection only. Finance renders aggregate cards before fetching complete details; complete responses replace summary wholesale. Summary retains receipt-confirmation counts and completeness warnings. Closed tax panels are not mounted until details are available. |
| Database work | Raw source reuse removes repeated order/payment/tax-ledger reads. Representative real PostgreSQL query plans were inspected read-only; measured plans do not justify additional indexes. No DDL was executed. |
| Background requests | Unread and website-order badges poll every 15 seconds after completion, pause while hidden, coalesce focus/visibility and explicit refreshes, and back off failures to 30/60/120 seconds. Existing Inbox message transport and 60-second authentication checks remain unchanged. |

The full report already carries filter options. The extra options endpoint is
now called only for nonempty dropdown searches, preserving remote selections.

## Freshness, failure and resource boundaries

Source cache: ten-second lifetime, eight source windows and 16 MiB of estimated
serialized UTF8 data. This is a retained-data budget, not a hard process heap
limit; temporary serialization, clones and active requests still use memory.
Values too large or impossible to size are not retained. Expiry/eviction cannot
resurrect an entry when an older request completes later. Waiters reuse a source
only after its owning transaction commits; failures are evicted.

Known pending ledger states are deterministic inputs under the snapshot guard
and remain visibly pending. SQL-unavailable sources are not retained. Existing
external historical-rate retry/caching behavior is unchanged. Database snapshot
identity includes database/schema/server start and the actual transaction token;
unrelated writes can also reduce cache hit rate. Unsupported snapshot probes
roll back their savepoint and bypass caching safely.

The browser stores no completed financial cache. Authentication transitions
invalidate pending generations synchronously; previous-generation responses
cannot be delivered. Workspace identity includes the authenticated user and
role. Direct Overview/Finance transitions may share a pending read; visiting a
writable workspace or returning from one invalidates pre-mutation requests,
including browser Back/Forward navigation. Finance's own successful mutations
invalidate pending generations before reloading.

Sorting/search/filter changes mark the displayed detail snapshot pending
immediately, including the debounce interval. Export and write actions are
blocked until filters match the completed response. A failed report clears
unavailable data, ends the busy state and offers retry instead of leaving a
permanent spinner. Request sequences still reject superseded responses.

Existing guards, `Cache-Control: no-store`, full report and CSV contracts,
money arithmetic, fixed monthly ESV, archive/void exclusions and durable business
history remain unchanged. Omitted `projection` retains the full response;
exports ignore the summary projection.

## Evidence and limits

- Executable cache tests cover commit failure, concurrent reads, mutation and
  worker snapshots, byte/entry eviction, pending states and summary/CSV parity.
- Eight concurrent fixture callers perform one raw source load and seven cache
  hits. Fourteen query variants produce 28 identical cached/uncached report and
  CSV results while reusing one source load. These are isolated test counters,
  not a production speed claim.
- The isolated PGlite PostgreSQL test proves unchanged snapshots reuse reads,
  while direct committed SQL changes invalidate them. No production data is
  written by that test.
- Real read-only representative EXPLAIN ANALYZE: active orders 1.379 ms, active
  payments 2.286 ms, latest sources 1.245 ms, latest lifecycle 24.636 ms; 29
  relevant existing indexes. These four selectors do not cover every report cost.
- Summary reduces response payload and defers detail consumption. It deliberately
  retains the same financial calculations; there is no separate CPU fast-path
  claim. First cold summary/full navigation uses two report HTTP requests;
  subsequent source reuse and fewer option/provider/polling requests are the
  intended savings.
- Final `pnpm quality:check` passed: API 2278 PASS/78 optional SKIP, web 820
  PASS/27 optional SKIP, database 28 PASS; total **3126 PASS, 105 optional SKIP,
  zero failures**. All typechecks and API/web builds passed after the last fix.
- Final Chromium acceptance: **8/8 PASS**. Desktop 1920x1080 and 1366x768 plus
  mobile 390x768 upper/detail screenshots were inspected. Tests check console
  errors, progressive loading, initial options-request removal, chart-local
  interaction, delayed same-role login, debounce/export guards and HTTP503 retry.
- Independent compatibility, regression, business/security, visual, Standards
  and Spec reviews passed. Final release gate accepted PASS_LOCAL_IMPLEMENTATION;
  future deployment remains pending authorization and exact-artifact gates.
  Local release-gate closure is recorded in the handoff;
  this is not production release authorization or installed acceptance.
  Production timing needs a later authorized deployment.

The stopped older 93-test browser suite is **not** counted as passing. It recorded
ten failures before cancellation: a prohibition on the existing ensure-current
POST, eight obsolete six-KPI expectations and an old invoice-editor expectation.
Base-source inspection confirms those contracts already differed on `fca28920`;
the baseline browser suite was not independently executed. The new targeted
browser acceptance is reported separately and does not claim all 93 tests green.

Private raw timings, plan metadata and screenshots stay in ignored `.local`.
No customer payloads, credentials or backup contents are added to this document.

Snapshot semantics: [PostgreSQL snapshot information](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-TXID-SNAPSHOT)
and [Repeatable Read](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-REPEATABLE-READ).
The caching approach is the project's inference from those documented semantics.
