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
