## 2026-11-12 - Website acquiring tax reconciliation

- Tax reconciliation accepts confirmed UAH gross and deposit date for a foreign-currency order. The original payment is retained in the audit snapshot. The UAH amount comes from the bank statement, including the actual acquiring fee.

## 2026-11-12 - CRM 0.19.4 installed

- Installed exact application commit `cfc436044690251b8f07215f7b86b233c53ac3e9`,
  frozen archive SHA-256 `6123be53d1d27013f74e0dde271e0cc2c0fc28bd310cb0c7d8d1a6e0e1191102`.
  API image `sha256:110f76650cb8964b5efe3ed097f4a5f0818f04dd836de0d8e9f04c78d8655108`,
  Web image `sha256:9ce82399025f395a8a3a52a43138e9397259cbc3f6d132995c7bc97e0cc704c3`.
- Exact quality gate and responsive Finance/Clients browser tests passed.
  Isolated PostgreSQL verified immediate HTTP 202 with NBU held, one job on retry,
  zero accruals and completion audits after disabling tax accounting, and one
  successful completion audit after re-enabling it.
- Public homepage and API health returned 200. Authenticated Finance/Clients
  smoke passed with zero new console errors. Version badge and release journal
  match the installed snapshot. Production tax calculation was not started as
  part of the smoke check.
- PostgreSQL and Redis container IDs were retained. No schema migration.
  The verified DATA backup `pre-tax0194-f37dcb71ec33-r01` passed isolated restore.
  The immediate 0.19.2 rollback source and Compose are preserved by the
  `yo-crm-v0194-cfc4360-planner` transaction; five tagged images per service
  and two ordinary active source sets were retained.

## 2026-11-12 - Manual tax calculation and Clients controls (LOCAL)

- Manual calculation now acknowledges immediately with HTTP 202 and a status
  identifier. Finance polls short read requests until completion and refreshes
  the selected report. One API process accepts one run at a time. Restarting the
  API clears transient status and retry resumes from persisted ledger evidence.
- Every manual ledger transaction rechecks enabled/revision under the settings
  lock. Disabling accounting during an FX wait interrupts remaining writes.

- The Finance tax card starts an authenticated calculation through today's
  Kyiv date, audits the checkpoint and refreshes the reports. Unresolved earlier
  sources remain eligible and explicit receipt confirmation is preserved.
- Receipt capture remains atomic with payment creation. Scheduled tax
  calculation and immediate post-payment reconciliation no longer run.
- Cash KPI comparisons use their own known amounts even if taxes are incomplete.
- A report request superseded by a month or filter change cannot announce a
  successful refresh after manual calculation. Browser regression covers a
  delayed old request and a failure loading the newly selected month.

## 2026-11-12 - Clients filters and actions on one row

- The existing sticky Clients controls place search and filters on the left
  and duplicate search, merge and creation on the right at desktop widths.
- Narrow screens stack the controls. Existing action handlers, focus targets,
  and the measured sticky offset for the table and client detail are preserved.
- The search hint fits alongside filters and actions at 1366 px. Chromium verified the complete hint and sticky alignment at 1920, 1366 and 390 px.

## 2026-11-07 - Authorized 0.19.3 deployment preparation

- Owner explicitly authorized deployment of the completed UI batch and requires
  current source on GitHub with every deployment.
- Candidate 0.19.3 updates package, changelog and visible release journal together.
  API/Web will be rebuilt from the same frozen source; no database migration.
- Implementation quality and all five local review roles passed before release
  metadata changes. Fresh deployment preflight and version/artifact review pending.
- Existing release tooling, backup/restore checks and two source-set retention
  policy will be reused. No production switch has happened for 0.19.3 yet.

## 2026-11-07 - Header copy cleanup and sticky Clients headings (LOCAL)

- Continued from the accepted 0.19.2 release, commit
  `124ab3fe5926fb9d6584299ae9144c133f1dea9a`. The older local entry below is
  historical: combined 0.19.2 was subsequently installed and accepted; see the
  deployment receipt in the operations worktree handoff.
- Current batch removes Clients/Orders descriptive subtitles and matches Orders
  and Tasks eyebrows to Clients Mantine Text styling. Task wording is sentence case.
- Clients reuses the existing sticky-controls hook and original table header;
  table data revisions trigger measurement after sorting/filter remounts.
- ScrollArea is horizontal-only with horizontal-only scrollbar offsets, removing
  the empty reserved right-hand vertical-scrollbar strip without changing the
  gap between the client list and details panel.
- Browser regression covers 1920/1366/390px, expanded filters, horizontal column
  alignment, sorting and absence of mutation requests: 3/3 PASS. Nine additional
  screenshot checks confirm matching Clients/Orders/Tasks eyebrow computed styles,
  subtitle removal, no overflow/page errors/API writes at 1920/1366/390px.
  Compatibility, regression, business and visual reviewers passed. Full
  `pnpm quality:check` passed (tests, typecheck, production build); generated
  next-env.d.ts matches HEAD. Final local release gatekeeper PASS. Evidence is under `.local/header-copy-cleanup` and
  `output/playwright/header-copy-cleanup`.
- No version bump, commit, push, deployment or production data changes in this batch.

## 2026-11-07 - Sticky Clients and Orders list controls (LOCAL)

- Owner authorized deployment after these changes. Integrator is preparing one
  combined 0.19.2 candidate; the earlier header-only 0.19.2 was staged/admitted
  but never installed. Its plan/artifacts require explicit audited retirement
  before the replacement candidate is admitted. Production remains 0.19.1.
- Isolated worktree `sticky-list-controls`, based on frozen 0.19.2. No version,
  commit, production, push or deployment operation performed.
- Clients search/filter controls and expanded filters stick below the shell.
  The desktop detail panel uses the measured controls height and actual shell
  scrollport height so it remains below them and inside the viewport.
- Orders command controls, chips and selection banner stick together. The one
  original table header is vertically translated inside its existing horizontal
  scroller; sorting, column sizing, refs and callbacks are retained. A scoped
  overflow override removes the legacy ancestor that prevented native sticky.
- Controls use opaque theme surfaces. Mobile controls use a compact responsive grid to leave
  room for rows. Focused order rows have measured toolbar/header scroll margins.
- Native mobile sort select occupies a full grid span. Actual select/Columns
  rectangles do not intersect at 390/320; selected values remain readable.
- Focused QA: 8/8 browser cases on 1920/1366/390/320 using local source devserver
  and synthetic API fixtures. Actual vertical/horizontal scroll, header/body
  alignment, column toggles, dropdowns, focus return, mobile Drawer, appended
  row retention and selected checkboxes passed; no page errors or API writes.
- Web typecheck and 25 focused tests passed. Web build passed before the final
  mobile sort/grid CSS refinement; parent runs final full quality on this patch.
  Browser evidence: `.local/sticky-controls-qa/`.
- Independent compatibility/business/regression/visual/release DAG reviews and
  any subsequent release remain the parent integrator's responsibility.

## 2026-11-07 - Clients and Orders responsive header placement (LOCAL)

- Base is deployed 0.19.1 commit 3149841fb8f17253f89c177d084608b7763dec16;
  the preceding local-only Tasks entry below is superseded by that release.
- Clients header statistics span the space beside the title. Existing duplicate,
  merge and create actions occupy the lower header row beside the subtitle.
- Orders KPI cards move into the header beside the title. Existing new-order
  trigger moves immediately before sorting in the command bar, retaining its ref,
  handlers and focus restoration. Summary columns adapt at narrower widths.
- No API, database, query, metric, permission or money calculation changes.
- Quality check and final Web build passed. Eight browser scenarios passed at
  1920/1366/390/320px, including dialog open/close and preserved filters.
  Evidence is under .local/header-layout-qa and .local/quality.log.
- Owner authorized deployment. Candidate 0.19.2 is frozen for qualification;
  installation and GitHub publication remain pending until installed acceptance.

## 2026-11-07 - Compact Tasks header and consistent list controls

- Moved the existing Tasks counters into the page header, beside the title
  and actions on desktop. Small screens retain a two-column counter grid.
- Restored theme-owned sizing and appearance of the Orders new-order button
  and removed the decorative dropdown glyph. Scoped legacy header-span
  overrides so Mantine can center its label.
- Removed the Inbox order-scope selector and visible per-channel numeric
  badges as requested. Kept the All counter and existing channel selection.
- Verification passed `pnpm quality:check`, 18 Tasks/Inbox browser cases,
  and nine screenshot scenarios covering all three pages at 1920/1366/390px.
  Historical Orders controls E2E has stale search/design-editor selectors;
  the changed new-order open/close path passed independently at each width.
- Local-only UI patch. Browser evidence uses synthetic API fixtures in
  `.local/tasks-header-visual/`; production has not been changed.

## 2026-11-07 - CRM 0.19.0 and new-host recovery guide

- Candidate source commit `862c29503e00e9da21176b8ef85eae908d694012`.
  Installed snapshot `462b4465fd0ce6ef283bddad778be2d511192b453e6cff15f31783f5fad3a304`.
  Web and API serve 0.19.0. The technical smoke returned HTTP 200 for the
  domain and health endpoint. PostgreSQL and Redis retained their container
  IDs. Schema 55 remained in place.
- Live browser smoke confirmed the release journal and snapshot, the Orders
  status color control, and one Clients archive action next to Filters.
  Selection enabled the action and opened the confirmation. The verification
  cancelled before any client archive or color preference write.
- The pre-cutover DATA snapshot `pre-order0190-462b4465fd0c` passed a separate
  isolated restore. Predeploy retention verified two ordinary source sets and
  five API and five Web image IDs. The retired ordinary uploads were moved
  to a private archive on the same filesystem.
- Installed Version Guardian and Release Gatekeeper passed. The accepted
  deployment pointer and private provenance were verified by read-back.
  Installed retention confirmed two ordinary source sets, two rollback
  roots, and five images per service. The 0.18.3 rollback pair is present.
- The candidate quality gate passed 3,357 tests with zero failures and
  110 skips. The affected workflows passed 24 browser scenarios.
- New-host recovery tooling and the [Russian operator guide](docs/NEW_HOST_RESTORE_RU.md)
  are source changes separate from the serving image. The installer verified
  synthetic DATA and FULL restores in local Docker, isolated browser login,
  blocked order writes and webhook ingress, and persistent DB and files after
  container recreation. The guide covers the separately operated public
  HTTPS cutover and preflight for a fresh Docker host.

## 2026-11-07 - Client archive moved to the filter toolbar

The list has one archive control next to Filters for owners and admins.
Only explicitly checked clients from the loaded list enter the confirmation
dialog. Archive requests retain the per-client freshness and order checks.
A partially successful request refreshes the list and reports failed clients.

## 2026-11-06 - Browser-local sales status colors in Orders

The color swatch beside a sales status opens a palette and a reset action.
The browser stores overrides by sales status and uses them to tint all matching
summary rows. The original status selector and its server mutation are separate
from this display preference. There are no database or API changes.

Local verification: pnpm quality:check and all nine Orders Playwright scenarios
passed. The color scenario covers reload, reset, cross-tab updates, status PATCH
rollback, and the picker and long status labels at 390 px.

## 2026-11-06 - Clients and Orders scrolling, Inbox order cards and invoices (0.18.3)

Clients places the four KPIs in the workspace header and pins the desktop
detail panel below the CRM header. Clients and Orders append pages near the end
of the list. Explicit pagination, filters, selection, and deep links remain
available. An overlapping or changed page total pauses append and offers a
refresh with the current criteria.

Inbox shows saved client invoices by order on every conversation channel. The
scoped PDF download is available in Instagram; composer attachment still
requires a supported channel. Listing or downloading an invoice never sends it.

Inbox reads non-void settlement receipts, shipment evidence, and client-owned
measurement references in a separate client-scoped order-card response.
Parcel tracking and the primary parcel's legacy mirror do not establish dispatch.
Active cards show payment, balance and measurement readiness; shipped cards
show delivery status and verified tracking links when available.

Local verification: pnpm quality:check passed (3,357 tests passed, 110
skipped). All 23 focused Playwright scenarios passed, with desktop and mobile
captures of the client list, order list and invoice picker.

Production switched to 0.18.3 from application commit
0330cfc800ccfdb7c859c4d534b949e8dc5a7610 and snapshot
5213de2ad561c3c5db9c416ce80d33ab67501bab1b0253acd3a279cc4405c2f0.
Guarded plan 8a7f59dd21cd reached the terminal runtime gate. Both public HTTP
checks returned 200. PostgreSQL and Redis retained their identities and schema
55 stayed in place. The consistent DATA copy pre-order0183-5213de2ad561 passed
isolated recovery before cutover.

Browser smoke confirmed the brand version and full revision in the first
release-journal entry, actual client order cards, the active-order invoice
picker and PDF link, and append from 20 to 40 rows on Clients and Orders.
There were zero new console errors. The smoke used no outbound messages.
Installed retention verified two ordinary source sets, four API images and
four web images. The exact 0.18.2 rollback images remain available.
Version Guardian and Release Gatekeeper accepted the installed release.
The current release pointer and provenance were verified after acceptance.

## 2026-11-06 - Client statistics and archive (0.18.2)

Clients shows four filtered KPIs across all pages from the same workspace
request. Active includes VIP, and repeat means at least two non-archived orders.
Owner and admin can archive a row with confirmation. The transaction checks
card freshness, refuses clients with non-archived orders and canonical merge
targets, and records activity and audit. Related records are retained.
An unambiguously matched first website order can reactivate a manually archived
buyer using the archive audit record. Exact replay stays idempotent.

Verified locally with 14 Playwright scenarios including desktop and mobile
archive and filter refresh, focused API tests, and isolated PostgreSQL KPI
counts with 10,000 synthetic clients and 50,000 orders.

Inbox projects Instagram ig_post CDN photos onto the guarded attachment route.
The API checks browser-compatible image signatures and serves the detected
content type when the provider mislabels a photo. Existing messages are read
as stored. An unavailable preview offers retry and a link to the original.

Order Details archives only the selected general, unlinked OrderFile and
retains its bytes and audit history. An additive nullable OrderFile.archivedAt
migration was verified with synthetic PostgreSQL rows and requires a guarded
migration deployment. Inbox can fetch and attach a saved invoice belonging to
the selected client via its existing composer. Invoice reads do not issue a
new document, change payment status or send a message. When Send is used,
the composer sends the PDF before any accompanying text. Instagram offers
a channel switch for PDF delivery.

Verified invoice selection and send with mocked providers, including autosaved
drafts, channel switches after a partial send, lost Gmail and Chatwoot responses,
and reconciled WhatsApp echoes. Exact attachment retries reuse the original
delivery even when provider display text differs or AI feedback was consumed.

Production switched to 0.18.2 from commit d5f2098c1955eca1e06dc2a635ad182fe206d37b,
snapshot 9782d6510940634ad8555da1c65e52af9bea4a70e5ec67c1670b6428e92b05d7.
Plan a5d1c154 completed and verified schema 55. Both production HTTP checks
returned 200. Browser smoke covered the logo, release journal, client KPIs,
orders list, Instagram photo preview and saved invoice picker. Archive writes
and invoice delivery were tested in isolation. The consistent DATA copy
pre-order0182-9782d6510940-r01 passed isolated recovery and migration rehearsal.
Two source sets remain active. 0.18.0 is historical and 0.18.1 is retained.

## 2026-11-06 - Inbox client search from CRM links (0.18.1)

Task, Order, Client and Overview links prefill Inbox with the client name.
The existing client and conversation IDs still determine the exact target.
The shell restores the filter on reload and browser history traversal.
Equivalent normalized filters do not cancel or duplicate the initial lookup.

Five browser cases passed with simulated data, covering a namesake, reload,
Clients round trip, global search and browser history, and unread filters.
The release contains no provider or database changes.

Installed application commit `5ce445d25f3e30ae4fd81be1d3dd54784dbb0926`
from snapshot `1bdc2e99b0300c33404d0468b465a8de9968255e55766834057279a60545d8fa`.
Quality passed with 3,322 tests and 111 conditional skips. DATA backup
`pre-order0181-1bdc2e99b030` and its isolated restore passed.
Public web and API health returned HTTP 200. The installed browser showed
0.18.1 and its journal entry, and passed the same five navigation cases using
synthetic API responses. PostgreSQL and Redis kept their original containers.
Installed retention verified two source sets, two rollback sets, two protected
service archives and five images per service.
The current pointer and installed provenance were verified. The private
`.local/deploy-v0181` evidence records plan
`6d5c0547e02fbc3a241455c31c40f8e4991257e7e00378056a97fb63fcd54703`
and provenance `64094dad22593397f5738b00b3785bba331dfd8b1ea8332739e198fe6655ea1d`.

## 2026-11-05 - Invoice heading typography and totals 0.18.0

Installed from application commit `9ca7598074050aaa3af2398f5ba58ba33cf84f8a`
and frozen snapshot `d9b40b76425561d5f1e10c123a542a7cddb7ba89f797be13910dba93fbf95e78`.
Invoice templates now support separate heading weight. New English invoices
default to Bill To / Customer and show a selected country without its default
label. Shipping appears once, in totals. Issued artifacts, payment policy,
agreed order totals, and the database schema are unchanged.

The quality gate passed (3322 tests, 111 conditional skips), including typecheck
and builds. The exact staged API invoice probe and isolated DATA restore passed.
After cutover the homepage and API health returned HTTP 200. The browser showed
the installed version and first journal entry, the heading control, and a
read-only 26-668 preview with EUR 25 shipping and EUR 390 total. PDF generation
succeeded with zero console errors; no business records were written by the
smoke checks. PostgreSQL and Redis kept their original containers.

Verified retention: two ordinary source sets, two rollback sets, two protected
service archives, and five images each for API and web. Installed proof
`0af8c562e80dcf1e3eef2f5e2533cd5c723a427f0828588f37e73cf6d9e3244f`
and plan `94c1ed450ac54dc28ebef18587087074932a23cc44f03033bbe986a07f61a374`
are recorded in the private `.local/deploy-v0180` evidence directory.

Version Guardian and Release Gatekeeper accepted the installed release. The
current-release pointer was verified and provenance recorded as SHA-256
`dfeeaab3f984d96825aa164fac417726f10f06872b4077346fa91ba92aeecf28`.


## 2026-11-05 - Delivery and invoice contact formatting 0.17.1

Delivery keeps one Add parcel action in the header. New invoice HTML and PDF
show customer email and phone without default labels, preserving explicit
template overrides and stored invoice artifacts. No migrations.

Installed from application commit `46ba17ad322568d14790341d165a67016c43d4c1`
and source snapshot `146f328d5df847da9e7854e750d1cba3874e065c6e7aac94405304e26786a145`.
The homepage and API health returned HTTP 200. In the browser, the brand and
first release journal entry showed 0.17.1, Delivery had one Add parcel button
beside Send tracking number, and the read-only invoice template preview showed
both contact values without the default labels. Nothing was saved or sent.

Quality gate passed with 3322 tests and 111 conditional skips, including
typecheck and build. The four Finance browser failures reproduced on 0.17.0
and were fixed in the test selectors and fixture. All nine shipment-expense
scenarios passed. The DATA backup and isolated restore drill passed.
Retention verified two ordinary source sets, two rollback sets, two protected
service archives, and five API and five web images.

Installed proof `98339949fb2f9137edd312a641c96b8d9f18fdb82284046283b75c149cbec969`
and closure `7319fd0887b85111d2e148ae9d96d6d4716f5e349f7e055c96a5356b71be0b99`
are recorded in the private invoice-template release worktree under
`.local/deploy-v0171/cutover-v4`.

Version Guardian and Release Gatekeeper accepted the installed release.
The current-release pointer was verified and provenance recorded as SHA-256
`2f07bc85ff0f54e6ccb49803dd3179ab8ca2daddbfa49ef924daa3be384d4876`.

## 2026-11-05 - Shipment notifications from Order Delivery

The Delivery tab offers the shared Inbox shipment-notification dialog beside
Add parcel for shipped orders with an eligible tracked shipment. It fixes the
order, lets staff choose among tracked parcels and active client conversations,
and requires explicit chat/email selection. Label-only shipments are excluded.
The existing preview, provider checks, audit, immutable retry scope and duplicate
protection are reused. The order-specific options response is additive. No
schema migration or live provider send was performed.

Installed as 0.17.0 from application commit
`e39825e377035f315ad23e1ea66df7438a3e3399` and frozen snapshot
`1ee56fe61f28b895a62ce2eb5772f38adeaf29cc15a95415c840168ec5337767`.
Homepage and API health returned HTTP 200. The browser verified the header,
first journal entry and notification preview with both channels, then closed
the preview without submitting. A tracked parcel without dispatch evidence
did not offer the action.
Quality checks passed (3322 passed, 111 conditional skips), including typecheck
and build. Three synthetic browser cases covered chat, email and both channels.
The pre-release DATA backup and isolated restore drill passed. Installed
retention verified two ordinary source sets, two rollback sets, two protected
service archives and five images each for API and web.
Installed proof `9eff4731251e81a20aeed4aa94de580a690ae53e6c2be243cf8842f49d53baed`
and closure `74b02b3f1475f208ca7aef1c3617a9ae303c58942d7060043f7d28cec638e1d0`
are in the private invoice-template release worktree under
`.local/deploy-v0170/cutover-v4`.

Version Guardian and Release Gatekeeper accepted the installed release. The
current-release pointer was verified. Release provenance SHA-256
`6d3942015fc7d762f3419052bb366da59361212018e9b8ed875cd6ecb4349b9b`.
The post-cutover retention receipt is `retention-installed-verified.py.result.json`.

## 2026-11-05 - Nova Global notification tracking links

New Nova Global previews and messages use `https://nova.global/track/?Tracking_ID=<number>`.
Verified legacy URLs resolve to the canonical route at read time, with no data migration.
Saved localized links, confirmed notification snapshots and replay scope remain intact.
The order delivery links use the same official domain. Owner authorized deployment after checks.

Installed at https://crm.yoleotard.com/ as 0.16.1 from application commit
`67e5d004ed414698bf4562fc92d5fd746a2bf9b3` and frozen snapshot
`f3630d249a3380300bcacf0a7fb5d2c2eb61e564db7869af383a9d9d91976468`.
The homepage and API health returned HTTP 200. The CRM header and first release
journal entry showed 0.16.1. Both delivery links for order 26-642 resolved to
the canonical domain with the full tracking number. No order or notification
writes were made during browser verification.
Quality checks passed (3317 tests, 111 conditional skips), including typecheck
and build. Synthetic notification previews passed on desktop and mobile.
The pre-release DATA backup and isolated restore drill passed. Retention
verified two ordinary and two rollback source sets plus protected SERVICE
sets, with five API and five web images.
Installed proof `33e803ba7552a9b7b2701d9826c5e810b696039d28c32ab8d9ee1ee42d43f2a7`
and runtime closure `e657587e82269474275af75e313d119f2b0202fd0f27712e9d82ee0178a5074c`
are recorded in the private `.local/deploy-v0161` evidence directory in the
invoice-template release worktree.
Independent Version Guardian and Release Gatekeeper accepted the installed
release. The guarded current-release pointer and provenance were verified
(provenance SHA-256 `bac6004a960c67ac81dcb611e38afef4265ac327cc46e9682c67cd9471a94552`).

## 2026-11-05 - Compact invoice layout and template typography 0.16.0

New invoice PDFs and previews use smaller margins, align customer contact
details with the seller, and keep payment instructions together where they
fit. Invoice templates support a base family, point size, and weight with
independent overrides by section. Ubuntu and Noto Serif fonts and licenses
are bundled for PDF and print preview. Saved invoice artifacts and calculations are
preserved. No migration is required. Owner authorized release after checks.

Installed at https://crm.yoleotard.com/ with commit
20f4a9c4511156ec9721f238df4e8d22af94bdc0 and source snapshot
4d66de78cc35f1ad017b36698aed8d64fe000ca892c6790dcc6fb44ab300937a.
API b96addeab5b7 and web 4718b80853a6 match staging. All four services
healthy. PostgreSQL and Redis identities and schema 54 verified.
Quality 3315 pass, 111 conditional skips, 0 fail. Typecheck and builds pass.
Linux operator tests 64/64. Consistent DATA backup and isolated restore
and cleanup passed. Production RTO was not measured.

Installed proof 6f6419af09c7ceb10a832d34795d4623d47cc830dd48818478b067c4bc7b277e,
coordination closure 4a9cbd4631df2a8e32da987267e141fe1303099387958c69bd5b0ed79af45c6e.
Browser verified version and full snapshot, first release journal entry,
document and section typography controls, and zero console errors. Closed
without saving a template. Post-cutover retention owner confirmed two ordinary
source and two rollback sets, two protected service archives, five API and
five web images, and no excess. Private records are in .local/deploy-v0160-r2/
(installed-proof.py.result.json, installed-cua-observation.txt,
publish-closure.py.result.json and retention-installed.py.result.json).
Version Guardian and Release Gatekeeper installed PASS. Guarded pointer CAS
verified. Current provenance 1d02652d280fb53736328ab55f5765429ddd26f71b59aced2768ec4d94039b06.


## 2026-11-05 - Invoice template editing 0.15.1 installed and verified

Owner-authorized narrow release is installed at https://crm.yoleotard.com/.
Frozen application source commit929da7e3ed5bd234ca8b2037007c1b04579db52f,
snapshotfd672e07c5b8823967c51ac2ef5bd36b58549994923f7c25aaca489cd7d76756;
API2b6a951153b7/webf84a1b5b1491. Four services healthy; PostgreSQL/Redis and
schema54 preserved. No migrations or financial formula changes. Consistent DATA
backup and isolated official restore/cleanup PASS; production RTO not claimed.
Quality3311PASS/111conditionalSKIP/0FAIL, types/builds and browser test PASS.
Actual installed CUA verified four editable builtins, SEPA fields/JSON/save action,
brand and first journal0.15.1/full snapshot, console errors absent. Closed without
saving any template. Existing saved invoice/PDF snapshots remain unchanged.
Native retry03 completed; gate/lease/flocks closed. Installed proof7fbe08e8e63fff2425e78b7384ac2823bdc2404cbc611d073b4142e9f4a12ca8;
pointerCAS verified, provenance06f5eb6677d58410b51ce0f2f5871b6869415ea4be5b30333425bbdf4713398b.
Version Guardian and Release Gatekeeper INSTALLED PASS. Application commit929da7e
was published to main; the v0.15.1 tag and runtime stay pinned to that commit. Main
may advance with documentation-only acceptance records, which do not change the
frozen runtime source. Earlier preparation entries are historical.

Standing retention policy: keep at most2 ordinary source archive sets and2 rollback
sets. Two separately protected service/recovery source archives remain (raw4 total),
not ordinary release sources; do not delete them without dependency audit. API/web
image limit remains5 each. Existing retention owner executed narrow cleanup and
fresh inventory reports2/2, service2, images5/5, no excess. Backups/data/volumes
untouched. Future deployment preparation must use these limits rather than5 source
sets. Preserve immutable attempt/receipt evidence and unrelated projects.

The shared-user cron check now pins only the exact CRM backup job and its effective
environment; other projects' jobs are read-only audit and were never modified.
Failed retry02 was safely closed by reviewed CRM-only manual recovery and natural
lease expiry before retry03; no lingering owner/fence. No unfinished hardening was
deployed or published. Details: docs/release-evidence/invoice-template-editing-deployment-2026-11-05.md.

## 2026-11-05 - Invoice template editing release 0.15.1 preparation

Owner authorized deployment and standing GitHub source publication. Clean release
from origin/main 4a1e2ae excludes all unfinished project-hardening work. Invoice
editing preserves built-in identity, inactive/archive overrides, audit/revisions,
saved invoice/PDF snapshots and required invoice seller validation. No migration,
financial formula, dependency, Dockerfile or Compose changes. Both API and web
will rebuild. Original local reviews and full quality PASS; clean release quality,
backup, exact artifact reviews and installed checks are pending. No installed
acceptance claimed. See docs/operations/INVOICE_TEMPLATE_EDITING.md.

## 2026-11-03 — Clients workspace refresh, local implementation

UPDATE: owner-authorized 0.15.0 is installed, with healthy API/web and schema54.
Application commit a739ed84ee79fb3058282703d2d860b9a8fa8ada is published on
origin/main. Frozen source83b4d312fc6b53d3cd3dcf41b387d972c2afc51cc162f9daed70a5a77c45d35b;
API5c47fad6841b/webd125db63c480. Original PostgreSQL/Redis retained. Fresh
consistent DATA backup, isolated official restore/cleanup and real-DATA shadow
qualification passed. The single additive ClientFile migration is applied;
application rollback retains schema54. Old0.14.1 cannot split new-format merges.
Actual CUA confirms Clients table/right card, lazy tabs, order photos/full-image
popup, exact Inbox/client roundtrip and brand/journal0.15.0/full source, with
zero console warnings/errors. Retention counts5/5/5/5; backups untouched.
Installed runtime/browser proof14bc215e94e99d988245f8dbfbf1aa22c9f30012cb1b49ec824dfbda5916c577;
pointer CAS verified, historical receipts preserved. Final provenance recorded:
b033b37f64eb7c722eed8ba3c0e0315467dfbdb4e5b13c2b1a529de5e1c9cf46.
Version Guardian INSTALLED PASS; final independent Release Gatekeeper INSTALLED PASS. No real-client
merge, customer send, production
restore or seed was performed. The paragraphs below preserve the earlier local
implementation record; their uncommitted/local-only wording is historical.

Active checkout: clients-workspace/YO_crm, branch codex/clients-workspace-refresh,
base c91c747e01af9239ef1bd36aba02e62950567d83. Owner requested the Clients ZIP
specification and approved PNG, explicitly excluding deployment. All changes
remain uncommitted; no push, production access or production migration occurred.

Existing clients module now has opt-in bounded workspace projections, server
filters/pagination, selected detail and lazy conversations/files. New responsive
table/right-card UI reuses order/measurement flows and exact Inbox navigation.
Safe batch merge extends existing merge/split provenance, CAS and audit; it
does not create a second history or identity store. Only additive ClientFile
routing migration is required. Catalog validation must pass before merge/split.
Nested message/payment/measurement counts are informational; stable parent FKs
preserve concurrently arriving records. Payment lock order changes no amounts.

Quality gate PASS: web845/API2394/database65 tests pass, 110 conditional suite
skips; all workspace types and builds pass. Explicit browser25/25 and native
PostgreSQL15/15 pass with no skips. The temporary synthetic loopback PostgreSQL
cluster has been stopped; shutdown verified. Generated next-env restored.
See docs/plans/clients-workspace-refresh.md for the audit and
docs/plans/clients-workspace-verification-2026-11-03.md for evidence and stable
screenshots in output/clients-workspace. Compatibility, regression, business,
visual and final Release Gatekeeper reviews all PASS for local acceptance.
That earlier verdict covered local acceptance only. Deployment is now explicitly
authorized and executed as recorded above; consult the deployment evidence for
the final installed acceptance, separate from this earlier local-only verdict.

## 2026-11-03 — Inbox header cleanup 0.14.1 installed

Application commit8acb2e489c0180d59d086891c4a5f863b99f8c74 is published on
origin/main. Frozen source189e4bcc4ab5d6af11d1f6398bb351b4b602ee2e6cbb2e3c7f0ff223b417f29a
is installed with APIb5fc3b0c/web317494dc images, both healthy. Original
PostgreSQL/Redis and schema53 remain. Fresh DATA and isolated restore/cleanup
passed. Existing operator reached RUNTIME_GATE_VERIFIED and emitted terminal
APPLIED after unwinding; independent PID/gate/lease/flock closure passed (no
launcher exit-code claim). Post-retention counts5/5/5/5. Actual CUA verifies
brand/journal0.14.1/full source and removed header duplicates, no console errors.
Version INSTALLED PASS; browser-verified installed proof931a1a7dbb6f0a1ee3aad9e17233a26fb72e37615421734f874fd202261cfdcc
published privately. Exact prior-pointer CAS and final provenance completed;
historical pointer bytes remain in the private intent record. Version and
RELEASE INSTALLED reviews PASS. Evidence-only GitHub publication follows;
runtime bytes stay frozen. Public report: docs/release-evidence/inbox-header-deployment-2026-11-03.md.

Separately, an owner-confirmed imported receipt was reconciled through the
installed TaxesService.confirmSource with normal audit/idempotency. Scoped
preflight and atomic postconditions passed: original payment and historical
ledger unchanged, two zero-amount confirmation entries appended. October live
Finance now reports complete calculation and no pending tax sources. Private
operational evidence stays under ignored .local; no application deployment.

Uncommitted UI patch removes the country chip beneath the chat name and the
single-channel source/@username repeat beside header actions. Primary channel
badges/profile link, multi-channel reply selector, actions and sidebar country
remain. Focused Inbox regressions96/96 and full quality PASS (3244 tests,
109 optional skips, typecheck and production build). Real local browser
screenshots cover single/multiple channels at1920,1366,390; no console warnings
or errors. Compatibility, regression, business and scoped visual reviews PASS.
Existing multichannel1366 overflow is outside the removal-only patch; no paired
baseline screenshot establishes an overall overflow pass. Private fixture has
no production/provider connection. Owner subsequently authorized deployment and
GitHub publication. Exact-version full quality, predeploy version/release gates
passed; both API/web were rebuilt with unchanged backend logic and schema53.

## 2026-11-03 — durable finance 0.14.0 installed

Owner-authorized deployment completed. Built application commit8d894ed8f106eb577274afe290bc2102bbe3922a
was published to GitHub before cutover; frozen sourcebff7949e067dc762bd4e03983f83ecdc9d1acf4f0afae870ce80c90b51043fc0.
Actual API60f0802ca940/webc6f7390de41b images are healthy with original PG/Redis,
schema53, coverage true/36 ALWAYS triggers and historical ingress guard1.
Exact plan8530ae292b18edf4a69b6580d0d9f34a80aae2ea4bef1e4b61f4faef1e13b764
completed exit0/APPLIED and RUNTIME_GATE_VERIFIED; separate closure proves gate,
lease and flocks released. No production restore, seed or financial smoke writes.

Fresh DATA-v4, isolated standard restore, full real-DATA shadow qualification,
old-image forced-rollback financial write seams, restored cache hits and final
post-shadow cleanup all passed. Canonical qualification4ee55402757d32f0c8ae15528f0b4a1f942df0293ea8ac793bdb239c925ac7bb.
Quality3243PASS/109optionalSKIP/0FAIL, native PG16, SQL193 comparisons, MVCC21,
responsive fixtures and independent predeploy reviews passed. Actual browser
Finance/FOP/Overview/statistics, brand and first journal0.14.0 and console passed.
Warm browser summary98.692ms/detail70.422ms versus2676.613/1815.387ms baseline;
first cold summary5494.509ms is explicitly slower and disclosed in the report.

Current pointer reconciled via CAS with preserved old bytes/history:
3d0c37c020c53baef8acf7af8020e62b92c06a01420030513fd5eae5d0c0ae11.
Installed proof583b3ad9e19c5301753a37e43d3f9ee2c59d34daa6ed80d0bd0aa5b791539453.
Post-cutover inventory5 rollback/5 release/5API/5web, no deletion targets; backups
and volumes preserved. Exact evidence, limitations and final acceptance are in
docs/release-evidence/finance-period-cache-deployment-2026-11-03.md.
Private .local helpers, DATA and credentials stay uncommitted. Application bytes
remain the frozen8d894ed build; subsequent publication is evidence-only.

## 2026-11-02 — 0.14.0 durable finance candidate, local gates complete

Owner authorized persistent PostgreSQL financial reporting and then deployment
AFTER completion, with current source publication to GitHub. INTEGRATOR checkout:
finance-report-performance, branch codex/finance-loading-optimization, base369d61a.
Production is still0.13.4/schema52; no production migration or cutover for this
candidate has occurred. New candidate version is0.14.0, API and web rebuilt.

Implemented three derivative tables, transactional revision/coverage triggers
for18 source tables, cross-process leases/checksums/CAS repair, independent
monthly cash/fiscal/tax input reuse, lifetime SQL payment facts and SQL detail
paging. Statistics has tokenless durable financial/counts projections; export
receipts remain actor/role/query-bound in memory. Existing raw MVCC cache,
batching, session/request guards, integer formulas and fixed monthly ESV remain.
Incomplete money stays null. Transient missing FX retries after30s; complete
historical and deterministic pending snapshots have no forced TTL.

Reviewed edge cases have regression proof: stale reader cannot revoke a newer
lease; boundary tax-expense IDs survive warm/range replay; equal-timestamp NFC/
NFD receipt IDs keep legacy metadata order; broken CSV artifacts are repaired;
same-instance negative FX can recover; mutable preceding-day tax inputs belong
only to their Kyiv month, so old adjacent copies cannot undo corrections/voids.

Final pnpm quality:check exit0: API2354/web824/database65 PASS =3243 PASS,
109 optional SKIP, zero FAIL; all typechecks and builds pass. Native PostgreSQL16
with all53 migrations passes full JSON/CSV, currencies, historical FX changes,
restart, five callers, pool1, tax/statistics derivative-only hits, Unicode ties,
and preceding-day correction/void. Activated MVCC/PGlite21/21 PASS. Eight browser
fixture paths and six responsive screenshots PASS. Independent compatibility,
regression, Spec/business and visual reviews have no open application blockers.
Private logs: .local/finance-periods. Operational/performance reports:
docs/operations/FINANCE_PERIOD_SNAPSHOTS.md and FINANCE_PERIOD_PERFORMANCE.md.

Plan/DAG: docs/plans/finance-period-snapshots.md and
.codex/dags/finance-period-snapshots.json. Remaining release-only work: freeze/
GitHub publication, exact image builds, fresh existing DATA52+isolated restore,
shadow schema53/rollback qualification, exact Linux operator/version/release
reviews, authorized cutover, retention and installed UI/HTTP verification.
Private adapters under .local/finance-period-deploy are not release-qualified
until pins and actual evidence are bound. Rollback retains schema53 with old
images; never restore production DB as an ordinary application rollback.

Fresh preflight confirms0.13.4 images850de594bf2e/1a2a8d010c82, snapshot14d01924d946,
healthy4 services. LIVE/.deployed-snapshot is stale0.13.0 metadata; it is not the
runtime identity. Reconcile its exact bytes/metadata by verified postcutover CAS,
retain historical evidence, and require installed version-guardian acceptance.

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
