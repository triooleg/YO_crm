# Bounded follow-up: ranges and compact mobile wizard

Workspace: `D:/CodexData/.codex/worktrees/pm-mobile/YO_crm`.

## Contract coordination for MAIN

Frontend implements the proposed user-message formula exactly:

```ts
`${version}:${rule.id}:m${field}:${Math.round(value * 2)}`
```

`value` is canonical cm. For a UUID version and <=8-character rule ID this is <=56 ASCII characters at the current technical maximum. Rule IDs must therefore be short server IDs (e.g. 8 characters), not a second UUID or an 80-character caller ID. No approved body ranges are shipped in frontend code.

IMPORTANT: inspected current staff-worker `apps/api/src/parent-measurements/parent-measurements-ranges.service.ts` uses `pmr:${sha256(JSON.stringify([version, rule.id, field, value*2]))}` and UUID rule IDs. That differs from the proposed literal frontend contract. MAIN must reconcile both implementations before integrated acceptance. This follow-up does not modify staff/backend-owned files or silently claim matching contract.

## Incremental manifest versus first handoff

Copy ONLY these changed files from this isolated workspace; do not recopy the first handoff wholesale:

```text
apps/web/lib/parent-measurements-model.ts
apps/web/lib/parent-measurements-i18n.ts
apps/web/components/parent-measurements/measurement-field.tsx
apps/web/components/parent-measurements/parent-measurements-wizard.tsx
apps/web/tests/parent-measurements-api.test.mjs
apps/web/e2e/parent-measurements.spec.ts
```

New files:

```text
apps/web/tests/parent-measurements-ranges.test.mjs
apps/web/tests/parent-measurements-ranges-handoff.md
```

No page/layout/CSS/theme/central i18n/QR helper/package changes in this follow-up. Preserve MAIN's force-dynamic page and central import integration. API production adapter is unchanged: it already forwards complete Session metadata and draft fields; additional API regression proves that start/recover/resume preserve `ranges` and save carries `rangeVersion` and acknowledgements.

## Behavior

- `RangePolicy` comes from Session only; null/absent version has no ranges, no slider and no invented defaults.
- `rangeForDraft` matches field and optional discipline; an exact discipline wins over generic. Height-bounded rules need actual height and use inclusive bounds. Height remains optional.
- New child, select, resume, revise and every edit synchronize policy version. Existing values are preserved. Policy changes clear all old acknowledgements; editing away from an acknowledged value permanently removes its code even if later restored.
- The real field receives range, acknowledgement and acknowledgement callback. Slider uses canonical 0.5 cm steps, bounds [L−3,U+3]. Manual outliers remain unchanged and need explicit consent.
- Mandatory step Next, additional-to-summary and submit all guard unacknowledged warnings; summary and additional screen show review controls for every configured outlier, including optional measures.
- A submit 409 exposes the existing explicit server-reload confirmation and freezes edits; reloading imports the new policy, clears old confirmations and autosaves the updated version before another submit.
- Measurement screen has no brand or duplicate visible field label; `aria-label="№N · caption"` stays. Language/units share a row, Back/Next share the footer, continue-later is a separate accessible compact action. Mantine xs/sm gaps only; no CSS changed. Instructions/errors remain visible.
- Welcome keeps valid link-provided invitation codes inside an explicit manual-entry accordion; no private fetch occurs automatically and consent/privacy remain.

Compactness evidence: m1 full-page screenshot at width 390 decreased from 1138 px in the first handoff to 982 px. Further approved-phone CSS sizing remains MAIN's explicitly assigned follow-up; this worker did not alter CSS or the common theme.

## Checks

- Red-first new model tests failed on absent exports, then PASS 4/4.
- Focused parent-measurements tests PASS 16/16.
- All web unit tests PASS 520, SKIP 1, FAIL 0 (521 total). Log `output/playwright/parent-measurements/web-tests-ranges.log`.
- TypeScript check PASS. Final `node node_modules/next/dist/bin/next build --webpack` PASS: compile 11.4s, TypeScript 10.6s, all 7 pages generated. Build wrapper restored next-env.d.ts.
- Final browser run PASS 12/12 (1.8m), including all previous flows and six-language/viewport checks. The initial optional-field browser test used getByLabel and matched both Accordion region and input; locator was narrowed to the textbox before rerun.
- Browser contract cases cover actual slider wiring, explicit acknowledgement, invalidation after edits, optional outlier gating, no submit request after unchecking in summary, 409/new-policy reload without old consent, and valid invitation manual entry. Synthetic ranges exist only in tests. Backend ownership/real PostgreSQL acceptance remains MAIN evidence.

SHA-256 preservation: 892 original baseline files unchanged; 12 protected files from the first handoff (including page/layout/CSS/QR/helper/first report/API/queue/photo components) also unchanged. No commits, push, merge, Prisma generation, database operations or deployment performed.

Screenshot hooks for MAIN CSS tuning: `.pm-root.pm-measure-screen`, `.pm-measurement-field`, `.pm-header`, `.pm-step`, `.pm-footer`. Existing screenshots under `output/playwright/parent-measurements/` were refreshed; compact m1 and `range-policy-reloaded.png` inspected with view_image. No instructions/errors/consent were hidden. The manual-entry accordion hides only the password field already filled from a valid link.

Integration gate remains BLOCKED on the acknowledgement encoding mismatch documented above until MAIN reconciles the backend and this proposed literal frontend contract. All local frontend checks are green; they are not a claim that the current SHA-based backend accepts this encoding.
