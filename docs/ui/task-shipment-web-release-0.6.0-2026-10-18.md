# CRM 0.6.0 — WEB deployment, 18 October 2026

User explicitly authorized deployment. Runtime source is
`036b95e2203b0cb0cefe0608b91a729df2dd5c71`, version `0.6.0`.
Only WEB was replaced. No database migration, seed, API restart, profile backfill,
provider action or production business mutation was performed by deployment.

## Changes and verification

- Task creation/editing offers client conversation and existing client order
  links. Multiple orders require explicit selection; new tabs preserve unsaved
  task text. Existing API guards remain authoritative.
- Parcel item selection captures checkbox state synchronously before the React
  state updater, fixing the demonstrated null-currentTarget crash.
- Final version-bearing `pnpm quality:check`: EXIT0, 1659 tests (1145 API,
  488 WEB, 26 database), types and Nest/Next builds. Generated ambient restored;
  subsequent WEB typecheck and whitespace checks passed.
- Local synthetic browser suite: 25 cases passed, including actual causal
  shipment RED before GREEN, exact saved IDs/CAS, currency regressions and task
  navigation. These local cases prove persistence; no real parcel/task was saved
  for production smoke.

## Backup and artifact identity

Verified FULL backup `20261018T124820Z-v050-pre-v060` under
`/home/trio/yoleotard-crm-backups/`: checksums, seekable PostgreSQL dump catalog,
uploads catalog, exact 0.5.0/source manifest and completed backup record passed.
This is not a restore drill or permission to overwrite later activity.

Archive has 834 files, SHA256
`602eb0cf8392300d00762b0b35264765c4f538bda96ccd254a5b58406d7367e1`.
498 protected files and all 37 historical migration SQL files match the previous
installed archive. The existing historical meta-inbox tracker/source checksum
difference is preserved; history was not rewritten.

The initial build using the repository lock was rejected for sharp/libvips and
Node type peer drift. Its image was never installed. The original WEB install
step was recovered from the old builder cache (`CACHED` verified), its generated
lock read privately, and the candidate rebuilt with frozen install. Node
v22.23.3 and all 13 traced runtime package entries exactly match installed WEB.
Failed and successful build receipts remain distinct.

Installed WEB image:
`sha256:eb56bf6710b51f9d1ab3b9abdd590e916e1992ad9c24f30f19c8c807b720baad`.
Retained API image:
`sha256:9a1c3904cf1c6147705203cbdd27f12fb89bd1fb970197d6e24a5e148d244464`.
API, PostgreSQL and Redis full container records (IDs, image, start time,
restart count, mounts, command/config hash) are identical before/after. Tracker
37, private configuration and source hashes passed. Old source is retained as
`/home/trio/yoleotard-crm-v050-evidence-036b95e`.

Only `web` was recreated using `--no-deps --no-build`. Operational helper SHA256
`7dabecab393a061811da3a8d49caa11b8493eb1bbdd98a385e16b195a0f2523f`
and exact image tuple received independent execution approval. Existing proxy,
ports and persistent storage were preserved. No automatic data restore is part
of recovery; use compatible WEB recovery while retaining API/schema/history.

## Installed smoke and limitations

Final authenticated read-only run: 123 checks, 18 private frames at 1366 and 390
pixels. Existing real parcel with initially unassigned items: six real checkbox
clicks per viewport, original selection restored, Cancel/reopen unchanged,
money/membership fingerprint unchanged. Task creation/editing on both viewports:
correct same-client order popup loads and scrolls to the actual order tabs, source form text
survives, then is restored/cancelled. Task record fingerprint unchanged.

Final run has zero page, console and HTTP errors, zero attempted business writes,
read marks, denied reads or external requests. Login/logout are expected auth
operations. Actual Inbox destination loading remains **UNAVAILABLE** under the
strict read-only bootstrap/media policy; its correct client-only href and real
client/conversation API reads were verified. Do not claim end-to-end Inbox
loading or live persistence. Earlier failed harness runs are retained separately:
the table-row screenshot and intentionally blocked Inbox bootstrap did not
demonstrate a product runtime regression.

External browser confirmed public root/health HTTP200 and visible 0.6.0.
Separate server canonical-SNI checks through existing local NPM also returned
HTTP200. Full startup-through-last-smoke API/new WEB logs were collected; old WEB
follow-log exited0 without timeout. No application error patterns were found.
All 26 selected full-row business fingerprints and task counts remained equal
through final post-check; sampled equality does not claim global quiescence.

Private receipts: `.local/task-shipment-web-deploy/`, final browser run
`runs/2026-10-18T13-14-03-780Z/`. Production screenshots are not published.
Independent visual review: scoped PASS for both changed features and actual
loaded order destinations at both widths. Mobile edit footer is visible; create
bottom actions remain a crop limitation, not a claim of complete pixel coverage.
Independent installed operational/smoke axes and tag readiness passed without
blocking findings. Native Inbox loading remains explicitly unverified above.

Immutable `crm-v0.6.0` points to runtime source `036b95e`. Exact-commit GitHub
[Quality gates](https://github.com/triooleg/YO_crm/actions/runs/39128737959) and
[CRM release](https://github.com/triooleg/YO_crm/actions/runs/39130749261) succeeded.
The subsequent documentation closure does not change installed source or images.

Final independent release closure: **PASS**, all required scoped gates complete.
