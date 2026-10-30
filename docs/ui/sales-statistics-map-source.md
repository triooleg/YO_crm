# Sales statistics world map

## Source and license

- Primary publisher: [Natural Earth, 1:110m cultural vectors](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/), Admin 0 — Countries, version **5.1.1**.
- Actual downloaded ZIP: [official NACIS CDN](https://naciscdn.org/naturalearth/110m/cultural/ne_110m_admin_0_countries.zip), retrieved 2026-10-18.
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/): map data are **public domain**, including commercial use and modification. No runtime requests or new runtime dependencies are needed.
- ZIP SHA-256: `0f243aeac8ac6cf26f0417285b0bd33ac47f1b5bdb719fd3e0df37d03ea37110`.
- SHP SHA-256: `08e341606e8391e458c3f08deb312de664b56bfae376064c5aa0aee6681a5f55`.
- DBF SHA-256: `1fee677cd4e03b367876e03861eb10197e4022a846bf92060e0313432863785b`.
- Generated `apps/web/lib/sales-statistics-world.ts` SHA-256: `cddbba38a7aa19d0bf08bdaa265e6bb29105fa6d66fd576830e1d3ff215e1b1f` (143,202 bytes).

## Geometry and normalization

The private Python standard-library generator reads the SHP polygon records and
their parallel UTF-8 DBF attributes directly. It strips both NUL and space padding
from DBF fields. All source polygon rings and all vertices are retained, including
islands, multipart countries, holes and the source's antimeridian splits.
Antarctica alone is omitted: 177 source objects become **176 rendered objects**,
**281 rings**, **9,993 vertices**, **173 unique ISO2 countries**.

Projection is plate carrée (equirectangular), with a uniform scale and fit into a
530 × 190 SVG viewBox; latitude bounds are −55.61183 to 83.64513. Projected points
are rounded to two decimal places (maximum error 0.005 SVG pixels per axis).
There is no shape substitution, invented polygon, boundary smoothing, external
tile server or hardcoded sales dataset.

ISO codes are validated against the 249 ISO entries in the already-installed
`flag-icons` 7.5.0 `country.json` (`iso: true`). This catalog supplies identifiers
only; all geometry comes from Natural Earth. Source exceptions are explicit:

| Source ADMIN | Source ISO_A2 | Rendered ISO2 |
| --- | --- | --- |
| Norway | `-99` | `NO` |
| France | `-99` | `FR` |
| Taiwan | `CN-TW` | `TW` |
| Northern Cyprus | `-99` | none |
| Somaliland | `-99` | none |
| Kosovo | `-99` | none |

The last three source features retain their geometry as neutral, noninteractive
land. They are never reassigned to a neighboring country's statistics. Natural
Earth's display of French Guiana within France, Greenland separately from Denmark,
and other multipart geography is preserved. Statistics are never split using
polygon area, locations or sovereign-state assumptions.

## Boundary point of view: Ukraine and Crimea

Natural Earth uses a [de facto boundary policy](https://www.naturalearthdata.com/about/disputed-boundaries-policy/).
This asset retains that source point of view rather than silently modifying
boundaries. In particular, the source polygon containing the Crimea sample
34.1° E, 45.3° N is Russia's polygon. This is a **source boundary rendering**,
not a legal assertion, postal-country rule or order classification.

The component joins only the server-provided `SalesGroup.country` ISO2 code.
An order classified `UA` stays in the `UA` group and callback; it is never moved
to `RU`, and country counts, money and client totals are never recalculated from
the map. Changing the boundary worldview requires a separately reviewed source
asset, not a country-code alias or transfer of statistics.

## Component integration contract

`SalesWorldMap({ groups: SalesGroup[], metric: SalesMetric, currency: string,
onCountry: (code: string) => void })` is exported from
`apps/web/components/sales-statistics-map.tsx`. Its stylesheet is imported by the
component and scoped to `.sales-map` / `.sales-map-tooltip`.

Types currently use a type-only import from
`../../api/src/overview/sales-statistics.types` (the correct relative path from
`apps/web/components`); no API implementation is bundled. The integrator may
replace this with the web type facade once it exists.

All feature text comes from `salesStatisticsUi.map` in the central dictionary:
`zoomIn`, `zoomOut`, `country`, `orders`, `pieces`, `amount`, `average`, `clients`,
`noData`, `selectCountry`, `openOrders`, `legend`. Country names use the supplied
group label, with the browser's Russian `Intl.DisplayNames` catalog for geometry
without a statistics group. Monetary formatting uses existing `moneyLabel`.

Known ISO countries with statistics are all included in the Mantine Select,
including small countries absent from this scale. Each unknown/invalid country
group has a distinct button using its supplied label and **original `group.key`**
for drill-down. Null country never paints a polygon. Country geometry accepts
pointer clicks and Enter/Space; Mantine Tooltip opens on hover and focus. Zoom
is bounded from 1× through 3× and changes SVG viewBox; keyboard focusing a country
while zoomed brings its source bounds into view. The complete country Select
remains available at every zoom level and viewport width.

Orders use exact bins `1–5`, `6–10`, `11–20`, `21–50`, `>50`.
Pieces use five equal positive integer ranges derived from the current maximum.
Amount uses five ranges derived from the current maximum, rounded upward to
whole major currency units; comparison stays in integer minor units. Legend
labels include metric and selected currency. Zero is neutral, missing monetary
values are gray with `noData`, and no conversion or zero substitution occurs.
No-statistics land stays neutral. The component assumes one aggregate per
normalized country, as supplied by the report contract; it never invents client
distinct counts by summing duplicate groups.

## Private generator and verification evidence

This worktree's ignored `.local/sales-stats-map/` contains the downloaded ZIP,
`generate.py`, `geometry-evidence.json` with all ZIP member hashes,
`validate-source.py`, `source-validation.json`, `map.test.cjs`, `typecheck.cjs`,
and private browser fixture/build/check scripts. It is generator/test evidence,
not production source or customer data. No new runtime libraries are installed.

Run from `D:/CodexData/.codex/worktrees/sales-stats-map`:

```powershell
python .local/sales-stats-map/generate.py
python .local/sales-stats-map/validate-source.py
node --test .local/sales-stats-map/map.test.cjs
node .local/sales-stats-map/typecheck.cjs
node .local/sales-stats-map/build-fixture.cjs
node .local/sales-stats-map/browser-check.cjs
```

The private browser fixture uses synthetic aggregates and a test-only copy of
the agreed dictionary keys while the UI worker owns central i18n. It bundles
the actual component, actual asset, actual Mantine controls/theme and actual
`moneyLabel` using already-installed build tooling, then serves on loopback only.
This is isolated component evidence; full-workspace compilation, integrated
visual comparison, the five independent review roles and final
`pnpm quality:check` remain the MAIN integrator's acceptance gates.

Verified on 2026-10-18 in this isolated worktree:

- Source validation: every one of 9,993 vertices matches the downloaded source
  after projection/rounding; regeneration is byte-for-byte deterministic.
- Private unit suite: **6/6 pass**, covering source feature/ring/vertex counts,
  ISO fallbacks, absent microstates, exact order bins, metric-specific scales,
  and missing money distinct from zero.
- Strict component TypeScript program: **0 diagnostics**, with the agreed
  private dictionary placeholder; no canonical dictionary edits.
- Bundled browser checks: **6 groups pass**, including actual pointer clicks,
  Enter/Space, all tooltip values, zoom restore, small-country Select and unknown
  drill, null financial data, mobile choices/overflow, and absence of external
  requests or browser errors.
- Inspected `desktop-orders.png`, `desktop-amount.png`, `mobile-orders.png`;
  additional captures at widths 1366 and 1920. Fixture viewport 1536×1024 and
  mobile 390×844. These verify the isolated card, not the full sales workspace.
- No commits, pushes, deployment, production data access, dependency edits,
  shared workspace/CSS edits or runtime API calls.
