## 2026-11-02 — 0.13.4 installed country/date editors

Authorized API/web deployment completed from commit
`3be732fee83519cc5105777b86a1f19fc7ea30be`, published toorigin/main. Snapshot
`14d01924d9464e8d4fef826482ff4dba8741b58abbadc0ef517cdbf7c5d7f64b`.
Installed API850de594bf2e / web1a2a8d010c82; all4healthy, PG/Redis unchanged,
guard1/schema52NATIVE_V1 retained. Public root/health200, UIbrand/firstjournal
0.13.4/fullsnapshot. Real browser verified missing/existing country editors and
search/cancel, created-date calendar and keyboardcancel, no new console errors.
No production client/order/payment test writes. Exact-version quality3138PASS /
107optionalSKIP /0FAIL, builds/typesPASS; Linux operator45/45PASS. Fresh DATA
consistentcapture +isolatedoffline restore/cleanupPASS; existingownerretention
post-check5/5/5/5 nofurthertargets. No migration/seed/productionrestore.
See `docs/release-evidence/client-country-created-date-deployment-2026-11-02.md`
for exact identities and honest test scope. VERSION GUARDIAN INSTALLED and final
RELEASE INSTALLED both PASS for the unchanged artifacts. Documentation-only
publication follows without changing installed bytes.

## 2026-11-02 — 0.13.4 deployment authorized (historical preparation)

Owner explicitly requested deployment of the reviewed country/date editors.
Scoped commit/push is authorized by the standing GitHub-with-deployment request.
Product version0.13.4 agrees in root/changelog/first UI journal. Rebuild both API
and web; retain PostgreSQL/Redis, existing proxy, guards and backup/retention
owners. No migration, seed, production restore or test payment/order writes.
Fresh baseline0.13.3 snapshot075c328a0f639046c9665b5496a9dd351fca9f37678c1c4443ac586e3d7c3bea;
API db36c902243f / web559935ee8147, all4healthy, sufficient disk. Private bundle
preparation `.local/country-date-deploy`; frozen quality, backup/drill, exact
artifact and installed reviews required. User confirmed stale0.12.11 was an old
browser tab; refresh shows current version. No automatic forced page refresh.

## 2026-11-02 — Client country and order creation date (local implementation history)

Owner added these requests while the frozen finance deployment was running.
Implemented and independently reviewed in `codex/client-country-inline` from
`3efa0ad7`, then the INTEGRATOR copied the exact verified 20 source/test files
plus evidence into this finance worktree after documentation commit `6ee59f7`.
No conflicting source or unrelated dirty changes were overwritten. Feature
remains uncommitted and NOT deployed; production is still exact0.13.3 below.

Client country (present or empty) opens the existing searchable Mantine country
catalogue, saves through the existing client PATCH/RBAC/CAS/audit, and refreshes
same-client rows without a page reload. Shipping/address country is untouched.
Order list created date opens a Mantine calendar and guarded timestamp PATCH;
strict UTC, expected old date, active-order CAS, audit/activity and Kyiv/DST
handling apply. Correcting a date preserves order number and all payment,
production and shipment dates/statuses. Statistics source/export caches are
invalidated after committed country/date changes; a stale pending DB/FX report
cannot register an obsolete CSV receipt.

Compatibility/Standards/Spec, business/security, regression and visual reviews
PASS, including 1920/1366/390 viewport overlays, keyboard/cancel/focus and a row
leaving the current period filter. Source worktree pinned quality exit0:
API2286PASS/79optionalSKIP, web823PASS/29optionalSKIP, database28PASS, both
builds/typechecks. Integrated full quality also PASS, exit0: API2287PASS/78SKIP,
web823PASS/29SKIP, database28PASS — 3138PASS/107optionalSKIP/0FAIL; typechecks
and both builds passed with the isolated PGlite check enabled. Final local
release gate PASS_LOCAL_IMPLEMENTATION; 20/20 source hashes still match. See
`docs/release-evidence/client-country-created-date-local-2026-11-02.md` and the
ignored feature artifacts for evidence. No feature version bump, commit/push or
production mutation.

## 2026-11-02 — 0.13.3 installed finance loading optimization

Authorized API/web deployment completed from source commit
`3efa0ad7e42c8f047358c824a3e11495223fe835`, published to `origin/main`;
snapshot `075c328a0f639046c9665b5496a9dd351fca9f37678c1c4443ac586e3d7c3bea`.
Installed API `db36c902243f`, web `559935ee8147`; all four services healthy,
PostgreSQL/Redis containers retained. Public root/health200, browser brand and
first journal entry0.13.3/full snapshot, Overview and Finance smoke passed with
no new console errors. Exact-version quality3126PASS/105optionalSKIP/0FAIL;
both builds/typechecks and Linux operator45/45PASS. Fresh consistent DATA and
isolated offline drill/cleanupPASS; existing retention owner confirmed5/5/5/5.
No migration, seed, production restore, payment/order write or history import.
See `docs/release-evidence/finance-loading-deployment-2026-11-02.md` for exact
images, guarded pre-lock refusal/retry evidence, measured loading limits and
scope. VERSION GUARDIAN INSTALLED and final RELEASE INSTALLED both PASS for
the exact unchanged images/snapshot. Documentation-only publication follows.

Later user requests (clickable client country and order creation-date editor)
are implemented locally as described above. They are NOT included in this frozen
production release. Do not mix their source with the finance installed identity.

## 2026-11-02 — 0.13.3 deployment preparation (historical)

Owner now explicitly authorizes deployment of the six verified improvements;
the standing request requires the exact current source on GitHub with deployment.
Commit/push of this scoped release is authorized. New product version 0.13.3;
root package, changelog and first UI journal entry agree. API and web must both
be rebuilt for the additive summary contract. No migrations, seed, production
restore, payment mutation or new history import is included.

Fresh preflight: healthy installed API/web0.13.2 snapshot
`adc4f992622c8ede213afa67bf309a77d94d243db8cd38f26f4da2db6def33b2`;
PostgreSQL/Redis retain their accepted containers, 270 GiB free. Use existing
backup/restore-drill and retention owners, max five release/rollback/API/web
artifacts. Frozen source, versioned quality, exact artifact predeploy review and
new consistent DATA/drill are required before cutover; installed acceptance is
not yet established. Private preparation lives in `.local/finance-loading-deploy`.

## 2026-11-02 — Six finance loading improvements (local implementation history)

Active branch `codex/finance-loading-optimization`, base `fca28920`; owner
authorized all six follow-up improvements. This is not another deployment or
permission to commit/push. Installed production remains frozen 0.13.2 below.

Implemented raw RepeatableRead/MVCC source reuse, optional summary projection,
shared in-flight financial GETs, summary-first Finance and summary-only Overview,
table-only refresh/search debounce, and visibility-aware badge polling. Existing
financial calculations, writes, auth checks and Inbox transport are preserved.
All completed money responses still require an authorized server read. Auth
generation is invalidated synchronously on session transitions and old response
delivery is rejected. See `docs/plans/finance-loading-optimization.md`.

Read-only production query-plan audit found no evidence justifying new indexes;
no DDL or financial mutation was performed. Final `pnpm quality:check` exit0:
API 2278 PASS/78 optional SKIP, web 820 PASS/27 optional SKIP, database 28 PASS;
all typechecks and both builds pass. Isolated PGlite snapshot test executed.
Final local Chromium acceptance: 8/8 PASS at 1920/1366/390, console/page errors
checked, including delayed same-role login, debounce/export guards and HTTP503
retry. Cache retained-data budget is eight entries/16 MiB estimated UTF8/10s;
known pending raw ledger states stay reusable under MVCC, SQL failures do not.
Summary keeps confirmation counts. Writable navigation boundaries invalidate
pre-write flights; aggregate scope mismatches hide old data immediately.

Independent compatibility, regression, business/security, visual, Standards and
Spec reviews PASS. Final release review: PASS_LOCAL_IMPLEMENTATION, no local
blockers. Future deployment remains pending separate authorization/versioning
and exact-artifact gates; no installed candidate claim. The stopped older
93-test browser suite is incomplete with pre-existing
contract mismatches confirmed in base source, not a baseline browser rerun.
See `docs/operations/FINANCE_LOADING_OPTIMIZATION.md` for exact limits and proof.
Version is not bumped; a future authorized release needs the next version,
new frozen artifacts and PREDEPLOY/INSTALLED VERSION GUARDIAN gates. Preserve
unrelated work in all other checkouts.

## 2026-11-02 — Finance report performance 0.13.2 installed

Authorized deployment completed at 2026-11-01T22:28:34Z. Source commit
`6124f1768ed679e3156b0d50bb9f2b23a3a0a598` is published on GitHub main;
runtime snapshot is
`adc4f992622c8ede213afa67bf309a77d94d243db8cd38f26f4da2db6def33b2`.
API and web are healthy on 0.13.2; PostgreSQL and Redis were not recreated.
Installed brand, release journal and public health agree on version/snapshot.
Overview and Finance browser smoke passed with zero new console errors.
Actual report requests measured 2530 ms on Overview and 2019 ms on Finance,
versus 4194/4061 ms before. These are individual observations, not an SLA.
Existing DATA backup plus isolated restore drill passed before cutover.
Postdeploy retention is five source releases, five rollback sets, five API
images and five web images. No production restore, migration or seed occurred.
See `docs/release-evidence/finance-performance-deployment-2026-11-02.md`.
This postdeploy documentation update does not change the frozen runtime bytes.

## 2026-11-01 — Finance report performance 0.13.2 preparation (historical)

Active worktree `finance-report-performance/YO_crm`, branch
`codex/finance-report-performance`, based on `097cb2f`. User asks to diagnose and
speed up Overview/Finance financial loading. User now explicitly authorizes
deployment and requires current code on GitHub for every deployment. Candidate
0.13.2 rebuilds API and web together; no migration/seed, no history import.
Fresh preflight confirms installed web/host0.13.1 and retained API0.13.0.

Browser baseline report response 4194/4061 ms; N+1 receipt reads in
`TaxesService.reportIn` replaced with request-local bulk SELECTs under the same
read snapshot. Real READ ONLY RepeatableRead differential: 502 queries/2234 ms
legacy versus 76 queries/315 ms candidate; full-result hashes identical.
No money, tax rules, payments, archival predicates, contracts, FX cache or UI
changed. No cross-request financial cache. See
`docs/operations/FINANCE_REPORT_PERFORMANCE.md` for scope and limits.

Four test-first batching regressions pass. `pnpm quality:check` exit0:
API 2257 PASS/78 SKIP, web 800 PASS/27 SKIP, database 28 PASS; all typechecks and
both builds pass. Independent regression and business reviews PASS; supplemental
Standards and Spec reviews PASS. UI-contract review PASS for unchanged frontend;
candidate responsive/installed browser smoke is unverified (no deployment).
Synthetic in-memory PostgreSQL proof: four selectors and ten complete reports
match legacy; dense fixture 476 to 15 SQL calls. All five independent roles PASS
for local implementation, including final release-gate review. This is not a
deployment clearance: installed candidate remains unverified; a future release
needs explicit authorization, version guardian and exact-artifact release gates.
Resume only this narrow diff; preserve unrelated work in other checkouts.

Previous pilot messages remain preserved. Per latest user direction, future chat
history collection must use original official sources only; do not start another
KeyCRM history import. The performance task does not authorize migration work.

## 2026-11-01 — 0.13.1 local-capture drill consistency correction

Pilot job0623ca00-d529-4375-8dc8-eb05cf05e31a contains308 acknowledged source records from two KeyCRM dialogues, both OWNER-bound to canonical The Samant/order26-642. Existing ClientsService.merge completed with all5 native messages/attachments/envelopes preserved. Preview213new/95 duplicate pairs/0conflicts; real OWNER preparation confirmed. No historical messages applied yet;41deferred retained, source completeness UNVERIFIED.

Actual job-bound DATA op-history-data-14e994e4-23c6-49a4-b3d6-7d2f29181ba5 and isolated DRILL op-history-drill-4e62e0fa-bb78-4a75-8a05-f7362f94d777 completed, drillPASS/cleanupPASS. Grant issuance correctly refused sourceConsistent=false: generic archive validation never attests local quiescence. This patch obtains source consistency only for a live-leased host DRILL bound in PostgreSQL to that exact completed local DATA source/checksum/size, within configured host storage; only then it consults the existing external capture receipt. Offline/fabricated/malformed/mismatched/symlinked receipts remain untrusted. Isolation, grant freshness, API, schema, auth and financial logic unchanged.

Candidate release0.13.1 rebuilds web only for version/journal; intentionally retains API0.13.0 image sha256:0c8c7ac4e80e27085788669574dfbccbaa1ca10167f2615491eec8f1f78ef464 from accepted source63574f6dd17c843e78adde3ae10984bb3e6ef47157e6b4bc4656bf98f3d9e82f. Host recovery-drill.py changes; original source/release receipts remain immutable. Exact artifacts, reviewed narrow adapter, retention and installed acceptance required before claiming deployment. No migration/seed/API recreation or automatic message apply.

Normal executor configs/live root ownership repaired previously: trio1000 owns normal configdir0700/configs0600 and LIVEroot0700/privateextras0600; source leaves root-owned. Preserve this on delivery. Root-only issuer settings mirror is separate exact-byte copy for existing issuer, not a second backup engine. Actual normal cron completion, not a one-shot root heartbeat, is the acceptance boundary.

## Operational history implementation 0.13.0

Controlled single-client history execution, owner confirmation, exact backup/drill
grant and selective rollback are implemented. Intake/planning/operational flags
default OFF. Existing49 migration leaves are preserved; three additive history
migrations require reviewed deployment. After any operational run, including a
rolled-back run, API historical ingress guard1 remains required. Source completeness
and ambiguous media remain separate acceptance checks. Runtime/deployment evidence
is recorded separately; this source handoff does not claim a completed import.
No browser automation, source credentials or private captures are shipped.
See docs/operations/HISTORY_MIGRATION.md.

## 2026-11-01 — 0.12.12 archive Inbox reader

API and web use snapshot
`ba0c6f92be5241b342a30a1f5b36d2af893dd385985707a37071ae94071a7801`.
Archive messages preserve per-dialogue order within minute ties. Inbox displays
source time precision and unavailable attachment inventory without inventing links.
Ordinary messaging, authorization and finance are unchanged. No historical writer,
schema migration, seed or operational history import is included in this release.
See `docs/release-evidence/history-reader-deployment-2026-11-01.md` for acceptance.
Publish exact reviewed release source to GitHub with every deployment. Private
operational handoffs, source captures, sessions and customer screenshots stay local.

# Technical handoff — 0.12.11 accepted installed

Version 0.12.11 is accepted installed: engineering, version, release, visual and read-only live checks passed for API and web. Source snapshot: e1e473e7918243179d0bdeecf4a0bd80b0c64f485c52e25f306f5215ef3950cb. Baseline: 0.12.10, snapshot 074d0d5ee71f3d00e73fac2803c16859840a9b06c611b3fa304e5dcc5880972d.

The release adds localized contact-copy actions using existing Mantine controls. Existing editing behavior remains covered. The release increment changes no API runtime, database schema or financial behavior.

Source publication base: 8378b45fd1f0d6f89eae8409a349edb0f88c2499. Its 1,374 non-handoff candidate files match the frozen source bytes exactly. CHAT_HANDOFF.md is an approved documentation-only privacy substitution; three pre-existing remote-only evidence documents are preserved. Publication evidence and subsequent documentation updates do not imply all 1,375 candidate files are byte-identical.

Quality and live verification are summarized in docs/release-evidence/contact-copy-deployment-2026-10-30.md. Clipboard behavior was tested using a browser Clipboard API stub; an operating-system clipboard write was not verified.

Installed image pins: API sha256:f856441dd06f59db98b209ba4b66e033e3b252fdc5ef69a6c7c971b86ab19c88; web sha256:3f6eba7f2104ecc7b42da8331eed7696a56e809a1fff70963bb063b4e13ee3d0. Post-deployment retention passed at 5 rollback sets, 5 releases, 5 API images and 5 web images. The backup executor is resumed and AVAILABLE with one owned cron entry; foreign cron and agent settings are preserved. Final installed release and visual reviews passed. This accepted record accompanies the main-branch fast-forward after installed acceptance.

Owner policy: GitHub must reflect the reviewed source for every deployment, including service-only releases and rollback. Publish the reviewed release branch before staging; fast-forward main after installed acceptance. Preserve remote-only development material unless removal is separately justified. Publish sanitized technical evidence only; exclude credentials, customer data, signed URLs and private operational history. Record actual deployment pins separately. No force-push.
