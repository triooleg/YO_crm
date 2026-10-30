# Sales statistics: previous-period KPI values

Owner specification, 2026-10-26. Local implementation only; no deployment,
production mutation, commit or publication authorized.

Extend the existing six sales-statistics KPI cards with Mantine numeric badges
for `previous.orders`, `pieces`, `countries`, `clients`, `repeatOrders`, and
`amountMinor`. Use the same report response for current, previous and delta.
Keep money formatting and financial role restrictions. Actual zero is `0`;
unavailable is `—`. A zero baseline has no percentage; rounded zero change is
neutral `0%`, without an arrow. Preserve KPI drill actions, filters, navigation,
graphs and existing Overview styling.

The audited API already selects the preceding inclusive calendar-day window of
equal length and applies identical predicates to both cohorts. No API, schema,
financial conversion or persisted-data change is needed.

Existing public test seams (as requested in the owner's verification scope):
the real sales aggregate, the web comparison/format helpers and the actual
rendered page with synthetic read-only HTTP boundary responses. Cover calendar
edges/leap/DST, distinct metrics and repeat history, archive/filter parity,
historical currency conversion, zero/missing, roles, and responsive placement.
Browser fixtures are not live database or live exchange-rate evidence.

Implementation ownership: INTEGRATOR owns the three statistics frontend files
and web tests; Feynman owns only the new backend comparison regression file.
All existing dirty backup/recovery changes remain outside this task.
Compatibility reviews plan and final diff; independent Regression, Business,
Visual and final Release reviews gate acceptance. Run `pnpm quality:check`,
browser regression and `git diff --check`; compare desktop/mobile screenshots
against the repository's approved design and a captured pre-change baseline.
