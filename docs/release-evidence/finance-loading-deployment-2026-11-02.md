# Finance loading optimization — installed 0.13.3

Owner authorized deployment and publication of the current source. Production
API and web now run 0.13.3 from Git commit
`3efa0ad7e42c8f047358c824a3e11495223fe835`, published to `origin/main`.
Frozen manifest: `075c328a0f639046c9665b5496a9dd351fca9f37678c1c4443ac586e3d7c3bea`.

## Artifacts and scope

- API image: `sha256:db36c902243f17665bd07b9e3fa6a02cc444f2c38f812ea06ff9e1d968bbe3b5`.
- Web image: `sha256:559935ee81473b6dc7d2a744a83dd1efc507e5c30cefb5ecee08e4b62e828fae`.
- Both OCI labels, embedded metadata, emitted web identity, public health and
  brand/journal agree on 0.13.3 and the full snapshot.
- PostgreSQL and Redis retain their original containers. No migration, seed,
  production restore, financial rule change, order/payment mutation or history
  import was performed. Normal finance entry used the existing FX refresh route.
- Narrow source installation: 27 task paths plus two previously published
  documentation reconciliation paths. Five historical absent evidence documents
  remain explicit exceptions; unrelated source and its CRLF bytes are preserved.

## Validation

Exact-version `pnpm quality:check`: exit 0; API 2278 PASS/78 optional SKIP,
web 820 PASS/27 optional SKIP, database 28 PASS. Total 3126 PASS/105 SKIP/0 FAIL;
typechecks and both production builds passed. Isolated database snapshot test
executed. Earlier focused Chromium acceptance: 8/8 PASS, including progressive
loading, session boundaries, debounce/error paths and desktop/mobile fixtures.
The older broader 93-scenario browser run was not accepted; its recorded legacy
failures and limits remain documented in the implementation report.

Independent application, operator/scope, version and release predeploy reviews
passed. The exact operator passed 45/45 boundary tests on Linux. A first launch
was refused by an occupied existing lock before lease, journal or source writes.
The dead process and entire unchanged baseline were verified under both locks;
its private marker/log/PID were durably archived before one reviewed retry.
No lock was forced, daemon killed, cron changed or uncertain mutation replayed.
The retry completed with `RUNTIME_GATE_VERIFIED` and ingress guard1 retained.

Fresh DATA capture `pre-finance-0133-075c328a0f63` passed validated local writer
quiescence. Its physical archive/checksums passed isolated offline restoration
and cleanup. The offline drill itself reports `sourceConsistent=false`; capture
consistency is separately established by the existing host validation receipt.
This is not a production recovery-time test.

Existing retention owner `d68421c7` removed one reviewed unused source cache and
two unused old image sets. Post-cutover inventory: five releases, five rollback
sets, five API images and five web images; no further targets. Backups, volumes,
current artifacts and protected rollback images were not deleted.

## Installed read-only browser smoke

Public `/` and `/api/health` returned 200; dependencies were up. Overview October
cards and Finance November cards/tables loaded. Brand and first release-journal
entry show 0.13.3/full snapshot. No new console errors were observed during the
post-health smoke. No production payment/order edit was used as a test.

One actual browser sample: Overview summary 2516 ms; Finance summary 2258 ms,
then full details in an additional 1609 ms. These are individual observed HTTP
durations, not a before/after benchmark or a guarantee of instant loading.
Initial tax-options requests: zero. Sorting issued one report GET, zero summary
GETs and zero FX refresh POSTs; ordinary badge/auth polls remain separate.
Completed financial responses are not cached in the browser. Raw source reuse
remains bounded and database-snapshot-sensitive; valuation is recalculated.

Private evidence and screenshots live in `.local/finance-loading-deploy` and
the server's existing private release bundle. No credentials/customer exports
are included here. Subsequent handoff/evidence publication is documentation-only
and does not change the frozen installed runtime identity above.

Country and order-creation-date editors requested during deployment are separate
local work and are not included in 0.13.3.
