# Previous-period KPI badges — local verification

## Scope

Six compact lavender Mantine badges show only the previous period's value.
Counts use the existing count formatter; amounts use the existing monetary
formatter and selected EUR/USD/UAH currency. Existing drill actions and the
single report request remain unchanged. No backend runtime, database, payment,
exchange-rate method, chart, filter or navigation changes.

Zero prior base keeps a visible `0` and neutral `—` percentage. Unavailable
values remain `—`. Equal or rounded-to-zero changes show neutral `0%`; growth
and decline retain green/red directional indicators. MANAGER sees no amount.

API audit confirmed the preceding inclusive calendar-day window of equal
length, identical filter predicates and independent per-period distinct sets.
The existing repeat-order definition remains unchanged. Twenty-four added
backend tests exercise these contracts, including historical FX evidence.

## Evidence and provenance

- `pnpm quality:check`: PASS, exit 0. API 1840 passed / 7 pre-existing skips;
  web 653 passed / 8 pre-existing skips; database 28 passed. Typecheck and both
  production builds passed, including the final repeat gate after CSS fixes.
  Private log: `.local/sales-comparison/quality-final.log`.
- Comparison helper: failing test before implementation; afterward 12/12 web
  statistics helper tests pass.
- Browser: real local Chromium at `http://127.0.0.1:3596`, synthetic read-only
  HTTP responses produced by the real aggregate. No real customer data or live
  exchange-rate claims. Full regression: 23/23 scenarios PASS (24 including the
  harness, zero skips). After final CSS changes: three comparison scenarios
  PASS; additional mobile UAH screenshot/geometry scenario PASS. Intentional
  case-selection skips in focused reruns do not replace the full regression.
- `git diff --check`: PASS for the complete working tree. Compatibility,
  Regression, Business/security and Visual independent reviews: PASS, no open
  blockers. Independent final release review: PASS / LOCAL_IMPLEMENTATION_ACCEPTED,
  including Standards/Spec review and a further 36/36 focused test run.

The browser harness now supplies the existing website-notification read
endpoint and compares a separately copied runtime only when explicitly
configured through `YO_SALES_RUNTIME_ROOT`. Normal checkout-based browser runs
validate served stylesheets and computed geometry directly.

## Visual comparison

Reference: `sales-statistics-approved-design.png` in this directory. The
existing before screenshot and final screenshots are in
`sales-statistics-comparison-2026-10-26/`. Existing page sections, six-card
desktop grid, graphs and filters are retained. Badges contain numbers only;
accessibility labels use existing Russian strings outside visible content.
Responsive checks cover 1920, 1366, 820, 390 and 320 px. Below 481 px the same
cards use one column to keep amounts readable. Long badge content wraps inside
its rectangle without overlapping headings or current values. Top/right-edge
placement has explicit browser assertions. Additional mobile UAH evidence
covers longer monetary text.

## Release state

LOCAL ONLY. No deployment, production connection/mutation, migration,
commit/push or version bump. Production remains the previously deployed 0.11.0.
Unrelated backup/recovery work is preserved. Production health and live smoke of
these changes are unverified: this task explicitly excludes deployment. Earlier
CSS hash receipts predate the final layout adjustment; subsequent layout/mobile
browser runs and the final production build verify the final CSS.
