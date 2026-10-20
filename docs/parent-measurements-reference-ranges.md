# Approved parent measurement reference pack

Local worker handoff, 2026-10-19. Scope: pure generator, tests and this document.
Specification: `docs/plans/parent-measurements-compact-ranges.md` in the integrator
worktree `D:/CodexData/.codex/worktrees/finance-approved-redesign/YO_crm`.
Planned compatibility PASS was read from that worktree's
`.local/parent-measurements-refinement/compatibility-plan.md` before source edits.

## Provenance

Originals were inspected visually in `D:/download/`. Only height, chest, waist,
hips and **full circular torso arc (ДУГА)** were transcribed. No sleeve, other
optional measurement, sex discriminator or adult gender chart was introduced.

| Original file | Coverage cm | Rows | SHA-256 of original bytes |
| --- | --- | --- | --- |
| IMG_20210223_095236 (1).jpg | 105–172 | 17 | `21cb1513aff594536136b544bbbfe589c35954c9a44808f0c73cf592f2ef07e4` |
| 1708664899317.jpg | 95–176 | 23 | `3b94dee146198ea9aa58ca0d71739064fd3893696e0a2400abcf85c343c8d51a` |

The source export contains the complete five-column transcription and hashes.
`PARENT_MEASUREMENTS_REFERENCE_PACK` identifies the immutable source/method
revision as `gym-two-charts-v1`. This identifier is provenance, not an AppSetting
policy UUID and not a substitute for an existing server-generated policy version.

## Approved calculation

For each canonical half-centimetre height from 95 through 176 inclusive, select
the nearest tabular height separately in each source whose own coverage contains
that actual height. Equal distances select the lower tabular height. For each
field use the minimum selected value minus 3 cm and maximum plus 3 cm. A source
outside its coverage contributes nothing; there is no extrapolation. No-height,
outside-coverage and noncanonical heights match no generated rule through the
existing backend selector.

The output is intentionally unscoped by discipline, matching the approved
two-chart method and existing generic `RangeRule` contract. No discipline or sex
is inferred from a photograph. Sources remain gymnastic charts, not universal
sizing/medical standards. Values must never be assigned to an athlete automatically.

| Height cm | Chest m1 | Waist m2 | Hips m3 | Full torso arc m15 |
| --- | --- | --- | --- | --- |
| 140 | 67–73 | 55–61 | 71–77 | 122–129 |
| 168 | 83–91 | 66–73 | 88–101 | 150–157 |

`generateParentMeasurementsReferenceRanges()` returns a fresh `RangeRule[]`.
It merges adjacent identical bounds per field into inclusive height intervals.
The 163 canonical heights produce **113 rules**: m1 28, m2 29, m3 28, m15 28.
IDs are deterministic and unique, use ASCII only, and have at most 7 characters
(contract limit 8). Rule count is below the existing 512-rule limit. All height
and measurement bounds satisfy the existing half-centimetre DTO contract.

There are no runtime imports, reads, writes, side effects, activation hooks or
fallbacks. Source metadata and rows are frozen; callers receive independent
mutable payloads. Metadata is deliberately separate from rules because the
existing configure DTO rejects additional properties.

## Verification and integration boundary

Red: the photograph-example test failed with ENOENT before generator creation.
Green: `node --test apps/api/tests/parent-measurements-reference-ranges.test.mjs
apps/api/tests/parent-measurements-ranges.test.mjs` passed **18/18** tests.

Coverage includes independent literal transcription, 140/168 examples, all 163
half-cm heights against an independently selected photo oracle, midpoint ties,
105/172 per-source transitions, 95/176 global endpoints, no overlap, full coverage,
maximal merging, excluded optional fields, IDs/count/grid, deterministic isolated
generation without runtime imports, frozen sources and independent results.

The generated payload passes the actual Nest ValidationPipe/configure DTO and
the existing service's public policy-read validation with a read-only in-memory
AppSetting fixture. Public range selection and acknowledgement functions verify
inclusive bounds, explicit exact-value acknowledgement, changed value/height,
stale version and absent/outside height. No database connection or write is used.

The isolated API typecheck passed. Final assembled quality, regression and visual evidence is recorded in the measurements workspace report.

Publication remains a separately authorized operation through the existing
OWNER/ADMIN API: pass generated rules, explicit approval and current expectedVersion;
the API owns immutable UUID version creation, CAS and audit. No publication,
service/controller/DTO/schema change, runtime wiring, commit, push, credential
access, database call or production action was performed by this pack.

