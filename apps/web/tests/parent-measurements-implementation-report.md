# Parent measurements mobile implementation — 2026-10-19

Workspace: `D:/CodexData/.codex/worktrees/pm-mobile/YO_crm`.
Status: frontend ready for MAIN integration; no commit, push, integration, migration, deployment or production action performed.

## Delivered

Real Mantine public wizard at `/parent-measurements`, outside CrmShell, with scoped CSS and inherited existing theme. Six complete dictionaries (RU/EN/FR/DE/ES/IT), manual language/units changes, browser/link locale detection, Arabic direction handling prepared. MAIN can re-export `parentMeasurementsRu` through central i18n without moving this isolated dictionary.

Welcome includes purpose/privacy text and unchecked representative consent. Shared invitation links do not auto-fetch a private session. Explicit buttons distinguish starting as a new parent from opening saved personal data. Resume 401 produces a localized no-session explanation. Canonical backend `#invite=...` and `#recovery=...` fragments are accepted and cleared from the address bar after reading; no credentials or PII are stored in localStorage/sessionStorage.

Own-child roster; add up to 10 children; optional age/height; all six actual CRM disciplines including OTHER; Kyiv business date; profile editing; original scheme and photo zoom; four required fields m1/m2/m3/m15; all 13 optional fields; progress/summary; explicit submission consent; server-confirmed receipt; immutable correction via `/revise`; archive only unsubmitted drafts; server recovery; shared links via Web Share/copy/WhatsApp/email and a real locally encoded QR.

Canonical measurements stay on the half-centimetre grid. Unit changes format existing cm without parsing the rounded display. Inch entry shows a proposed half-cm rounding and needs confirmation before changing stored values. Technical maximum 9999.5 cm and age maximum 120 match the inspected MAIN normalizer; these are not invented body norms. Existing approved height standards are available only through an explicit button, fill empty mapped values and never copy legacy m6. No body ranges are invented. The field accepts future approved ranges; the helper computes [L−3,U+3] and the slider stays on the internal 0.5 cm grid. Default UI is numeric input.

Debounced per-child autosave serializes CAS revisions. Late responses advance revision but do not replace newer editor values. CAS conflict stops writes and needs explicit confirmation before loading the server version. Offline edits stay in memory with an honest warning and beforeunload protection. Ambiguous submit freezes editing and retries the same operationKey and revision, preventing a new operation from being invented after a lost response.

Optional child photo is JPEG/PNG/WebP <=2 MiB; upload uses authenticated JSON POST `/photos/:id`. Viewing explicitly fetches the guarded endpoint as a blob, with no public URL or third-party photo. Object URLs are revoked. Existing `photoUrl` metadata is retained when save responses omit it; it is never used as an external image source. Child avatars use initials only.

## Exact new owned paths

All paths below are relative to `D:/CodexData/.codex/worktrees/pm-mobile/YO_crm/`.

```text
apps/web/app/parent-measurements/page.tsx
apps/web/app/parent-measurements/layout.tsx
apps/web/app/parent-measurements/parent-measurements.css
apps/web/components/parent-measurements/measurement-field.tsx
apps/web/components/parent-measurements/parent-measurements-wizard.tsx
apps/web/components/parent-measurements/private-photo.tsx
apps/web/components/parent-measurements/shared-link-qr.tsx
apps/web/lib/parent-measurements-api.ts
apps/web/lib/parent-measurements-autosave.ts
apps/web/lib/parent-measurements-i18n.ts
apps/web/lib/parent-measurements-model.ts
apps/web/public/parent-measurements/reference-1.jpg
apps/web/public/parent-measurements/reference-2.jpg
apps/web/public/parent-measurements/reference-3.jpg
apps/web/public/parent-measurements/reference-15.jpg
apps/web/public/parent-measurements/reference-17.png
apps/web/tests/parent-measurements-api.test.mjs
apps/web/tests/parent-measurements-autosave.test.mjs
apps/web/tests/parent-measurements-model.test.mjs
apps/web/tests/parent-measurements.playwright.config.ts
apps/web/tests/parent-measurements-implementation-report.md
apps/web/e2e/parent-measurements.spec.ts
```

Shared dependency copied unchanged from staff worker for local verification:
`apps/web/lib/parent-measurements-qr.ts`. STAFF/MAIN own that helper and the pinned `qrcode@1.5.4` dependency/types. It exports `measurementLinkQrDataUrl(url):Promise<string>`. Do not overwrite a newer staff version when integrating this worker's files. No package file was changed here.

## Verification evidence

Commands from `apps/web`, except tsc from workspace root:

```text
node --test tests/parent-measurements-*.test.mjs
  PASS 11/11
node --test tests/*.test.mjs
  PASS 515, SKIP 1, FAIL 0 (516 total)
node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false
  PASS
node node_modules/next/dist/bin/next build --webpack
  PASS (final compile 11.1s, TypeScript 5.8s, all 7 pages generated)
node node_modules/@playwright/test/cli.js test --config=tests/parent-measurements.playwright.config.ts
  PASS 9/9 against the final production build on local port 3517 (15.1s)
  Previous dev-server run also PASS 9/9.
```

Browser scenarios: complete four-required-values submit and revision; lost-response submit with one operation key; explicit inch rounding and repeated cm/in switches; private recovery without QR; no automatic private reads; explicit resume; offline warning and CAS stop/reload; six languages at widths 320/360/375/390/430/768/1366/1920, no horizontal page overflow.

Red-first evidence recorded in execution: missing model failed before implementation; missing autosave failed before queue implementation; canonical `#invite` test failed with empty token before parser fix; standard/range helper tests failed before exports were added. Browser run reproduced StrictMode consuming the entry token twice before the once-only read fix. Another browser failure was a test locator using textbox instead of Mantine Select's combobox; the locator was corrected.

Browser tests use an explicit HTTP-contract harness in the test file only. Production components always use the real `/api/public/parent-measurements` endpoints. These browser tests are not proof of backend ownership, real PostgreSQL transaction safety, recovery replay handling, or three-parent server isolation. MAIN owns those live local integration checks.

Screenshots: `output/playwright/parent-measurements/` (welcome, settings, profile, guide, m1/m2/m3/m15, additional, summary, success, share-qr, recovery, and six locale variants at 320/390). Inspected with view_image: approved prototype, m1, m15, summary, shared QR, recovery and German 320. Original mannequin images are byte-identical to the input manifest by SHA-256. No mock child photos were added.

Full web test log: `output/playwright/parent-measurements/web-tests.log`.

The installed pnpm runner rejected junction `node_modules` with `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`; Turbopack rejected dependencies outside its root. Direct installed Node/TypeScript/Next/Playwright commands and webpack were used without changing dependencies/config. The build wrapper restored the pre-existing bytes of next-env.d.ts after each build. `next start` served the local production build for browser validation, with the existing standalone-output warning; deployment remains MAIN's responsibility.

## Preservation and review handoff

SHA-256 comparison against MAIN's pre-worker `.local/parent-measurements-implementation/baseline.json`: 892 baseline files checked, zero changes. Existing global layout, theme, next.config, central i18n, package files, Prisma and unrelated dirty files were preserved. Static copied assets matched the approved source hashes. `git diff --check` found no issues on the owned surface.

Manual standards/spec check: additive public files only; existing staff measurement labels untouched; m6 explicitly means no allowance; no m6 preset copy; correct four-required count; UNKNOWN/OTHER concepts are not invented; API values remain numeric cm; no staff authorization path is invoked; no child/client/order identity is treated as authority by the UI.

MAIN must update the canonical CHAT_HANDOFF.md and run the mandatory independent compatibility, regression, business/security, visual and release roles after integration. No independent reviewer PASS or global `pnpm quality:check` is claimed by this worker. The root quality command invokes db:generate, forbidden for this shared-dependency worker; only the affected web checks were run. Real private-photo upload/read and three independent parent sessions still need MAIN's integrated HTTP/browser proof. Atelier ranges remain intentionally unconfigured until approved; the public privacy wording still requires the planned release review.
