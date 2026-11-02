# Client country and order created date — local integration evidence

Historical local implementation evidence below. Owner subsequently authorized
deployment; these editors are now installed as0.13.4. Exact deployed identities
and installed checks are in
`client-country-created-date-deployment-2026-11-02.md`.

Worktree: `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm`.
Branch: `codex/client-country-inline`; HEAD/base: `3efa0ad7e42c8f047358c824a3e11495223fe835`.
Status: PASS_LOCAL_IMPLEMENTATION. Uncommitted local feature; all mandatory independent review roles and supplemental Standards/Spec PASS.
No production access, deployment, version bump, commit, push or integration.

## Behavior and boundaries

- Client.country only: existing CountrySelect/catalog and client PATCH, current version guard/RBAC/audit. New labels in i18n; missing country is an actual clickable button. No country list duplication, no shipping/address writes.
- Created date: `/orders/:id/created-at`, strict canonical ISO UTC and expected original timestamp, OWNER/ADMIN/MANAGER, CAS and transactional activity/before-after audit. Only createdAt plus Prisma updatedAt changes. Order number preserved across years; payment, production and shipment dates/statuses untouched.
- UI day/time follows Europe/Kyiv even in a Los Angeles browser. DST gaps fail, overlaps prefer original offset, milliseconds retained. Existing statistical createdAt readers update without replacing calculations.
- Narrow postcommit SalesStatisticsService invalidation for actual country/date changes; no-op and failed transactions leave caches alone. Revision checks cover pending source reads and awaited FX before report/CSV publication. Stale reports fail with 409; no obsolete CSV token is registered.
- Same-client rows merge immediately, then normal detail/list refresh. A server month-filter removes a backdated row without corrupting or attaching it to surviving rows.

## Executable evidence

All paths below are inside this worktree. `.local` artifacts are ignored and should not be integrated.

- Red: `.local/client-country-inline/country-red.log`, `date-red.log`, `date-ui-red.log`, `timezone-red.log`, `stats-red.log`, `client-invalidation-red.log`, `fx-race-red.log`.
- Focused API: `node --test apps/api/tests/client-country-inline.test.mjs apps/api/tests/order-created-at.test.mjs apps/api/tests/sales-statistics-service.test.mjs` — 12 PASS (`api-focused-final2.log`).
- Kyiv/leap/DST: `node --test apps/web/tests/order-created-date.test.mjs` — 3 PASS.
- Country + existing phone/email: `YO_CLIENT_CONTACT_BROWSER=1 node --test apps/web/tests/client-contact-editor-browser.test.mjs` — 14 PASS (`visual-final.log`).
- Date widget: `YO_ORDER_CREATED_DATE_BROWSER=1 node --test apps/web/tests/order-created-date-browser.test.mjs` — 5 PASS (`browser-final.log`), browser timezone America/Los_Angeles.
- Actual dashboard: `YO_ORDER_INLINE_FIELDS_BROWSER=1 node --test apps/web/tests/orders-inline-fields-browser.test.mjs` — latest `dashboard-acceptance3.log`; date/country, keyboard and filtered-row disappearance.
- Full stable-source `pnpm quality:check`: PASS, exit 0 (`quality-acceptance.log` / `quality-acceptance.exit`). API 2286 PASS / 79 optional SKIP; web 823 PASS / 29 optional SKIP; database 28 PASS. All typechecks and API/web builds pass. The repository-pinned pnpm 11.16.0 rerun also PASS, exit 0 (`quality-pinned.log` / `quality-pinned.exit`), with the same counts, all typechecks and both builds. No production/test source changed between the two green runs. Previous `quality-final.log` overlapped the intentionally added red FX regression and correctly failed; the stable-source runs supersede it.

## Screenshots

Actual OrdersDashboard fixture (real component/theme/CSS, synthetic localhost API):
`.local/orders-inline-fields/browser/before-1366.png`, `after-1920.png`, `after-1366.png`, `after-390.png`,
`country-viewport-1920.png`, `country-viewport-1366.png`, `country-viewport-390.png`,
`date-viewport-1920.png`, `date-viewport-1366.png`, `date-viewport-390.png`, `filtered-date-390.png`.

Old full-page `country-390.png` was insufficient evidence. Viewport recaptures scroll the trigger to center, await open overlays and verify country-list boundaries. The integration fixture now includes the same Mantine dates stylesheet already present in production layout; no production CSS change was needed.

## Reviews

Planned compatibility PASS. Standards PASS. Spec required handoff, now added.
Final compatibility PASS (`compatibility-contract-guardian-final.txt`); regression PASS (`regression-guardian-final.txt`); Standards and Spec PASS (`review-standards-final.txt`, `review-spec-final.txt`). Final BUSINESS/SECURITY PASS from Galileo thread `01a199ee-1f1f-7cc1-846d-0c4988c6dca6`, independently reran 12 API + 3 date tests. Final VISUAL PASS from Copernicus thread `01a199ef-1f4f-7180-b2bd-58c35eba9c5d` for all six actual viewport overlays, 1920/1366/390. Release gatekeeper: PASS_LOCAL_IMPLEMENTATION (`.local/client-country-inline/release-gatekeeper-final.txt`); exact 22-file surface and all 20 source/test hashes verified. Installed/live and deployment gates are explicitly out of scope.
Galileo/Nietzsche FX-await blocker reproduced red and fixed with a report-wide revision guard. Copernicus actual-overlay evidence gap addressed by viewport captures and keyboard/filter acceptance.
Installed/live smoke intentionally unverified; feature is not deployed.

## Parent integration rules

Parent integration subsequently copied the exact 20 verified source/test bytes
and this evidence document to `finance-report-performance/YO_crm` after its
documentation commit `6ee59f7`. Canonical handoff was merged as a new introduction;
the installed0.13.3 record was preserved. Feature remains uncommitted and not
deployed. Source/test SHA identities remain those reviewed below. Integrated
`pnpm quality:check` exit0: API2287PASS/78optionalSKIP, web823PASS/29optionalSKIP,
database28PASS; total3138PASS/107SKIP/0FAIL, typechecks and both builds passed.
The isolated PGlite check was enabled. Tesla's independent final integrated
release review is PASS_LOCAL_IMPLEMENTATION. Exact parent evidence:
`.local/finance-loading-deploy/inline-integrated-quality.log` and exit file.

Parent reports finance 0.13.3 deployed from `3efa0ad7`, with GitHub documentation commit `6ee59f7`. This feature remains uncommitted and NOT deployed; no new deployment scope exists.

Merge only the new feature introduction from this worktree's CHAT_HANDOFF.md into the parent's current canonical handoff. Do not copy/replace the complete file or replay its inherited finance history over the parent's new deployment record. Pascal regression PASS accepts the frozen 20-source/test manifest and pinned quality evidence. Parent final reviews remain independently owned. No source/test edits after freeze unless responding to a finding.

## Exact frozen source/test manifest — 20 paths

- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/app.module.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/clients/clients.service.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/orders/orders.controller.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/orders/orders.dto.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/orders/orders.service.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/src/overview/sales-statistics.service.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/tests/client-country-inline.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/tests/order-created-at.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/tests/sales-statistics-service.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/crm/country-select.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/orders-dashboard.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/orders/client-contact-editor.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/orders/order-created-date-editor.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/orders/order-expanded-tabs.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/lib/i18n.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/lib/order-created-date.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/client-contact-editor-browser.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/order-created-date-browser.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/order-created-date.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/orders-inline-fields-browser.test.mjs`

## Documentation paths — 2 additional files

- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/CHAT_HANDOFF.md`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/docs/release-evidence/client-country-created-date-local-2026-11-02.md`

## New untracked files — include these during integration

- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/tests/client-country-inline.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/api/tests/order-created-at.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/components/orders/order-created-date-editor.tsx`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/lib/order-created-date.ts`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/order-created-date-browser.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/order-created-date.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/apps/web/tests/orders-inline-fields-browser.test.mjs`
- `D:/CodexData/.codex/worktrees/client-country-inline/YO_crm/docs/release-evidence/client-country-created-date-local-2026-11-02.md`

## Reproduce with the pinned package manager (PowerShell)

Run from the feature worktree; the full quality log `quality-pinned.log` and `quality-pinned.exit` already record PASS with pnpm 11.16.0.

```powershell
corepack pnpm --version
corepack pnpm quality:check
node --test apps/api/tests/client-country-inline.test.mjs apps/api/tests/order-created-at.test.mjs apps/api/tests/sales-statistics-service.test.mjs
node --test apps/web/tests/order-created-date.test.mjs
$env:YO_CLIENT_CONTACT_BROWSER='1'; node --test apps/web/tests/client-contact-editor-browser.test.mjs
$env:YO_ORDER_CREATED_DATE_BROWSER='1'; node --test apps/web/tests/order-created-date-browser.test.mjs
$env:YO_ORDER_INLINE_FIELDS_BROWSER='1'; node --test apps/web/tests/orders-inline-fields-browser.test.mjs
git diff --check
```

No command above authorizes deployment, migration, production mutation, commit or push. `.local` logs/screenshots/hash manifest are review artifacts, not integration paths.
