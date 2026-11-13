# Invoice template editing 0.15.1 — accepted deployment

Date: 2026-11-05. Owner authorized deployment and GitHub source publication.
Production: https://crm.yoleotard.com/. Application commit:
`929da7e3ed5bd234ca8b2037007c1b04579db52f`; tag `v0.15.1`.
Documentation acceptance records are separate from the frozen runtime source.

## Delivered behavior

Settings → Invoice templates now edits existing built-in and custom templates
through the existing form. First built-in save retains the same template identity;
inactive/archive overrides cannot resurrect the compiled fallback. Revision checks,
audit and API permissions remain. Existing saved documents/PDF snapshots remain
unchanged. No financial formulas, migrations, dependencies or Compose changes.

## Exact installed artifacts

- Snapshot: `fd672e07c5b8823967c51ac2ef5bd36b58549994923f7c25aaca489cd7d76756`.
- API: `sha256:2b6a951153b7e4ba8a2a68018acdb6be678912eefc9db8fac369d09e99745f97`.
- Web: `sha256:f84a1b5b149180e83d3ce826ed8b120a9456452ee79c9090ebaa66d3449b61b4`.
- Plan: `e27f383d87b0a4f884e26e0ca74307242d9b901dccaa7ac1f08880916a1a60c2`.
- Installed runtime/browser proof: `7fbe08e8e63fff2425e78b7384ac2823bdc2404cbc611d073b4142e9f4a12ca8`.
- Current provenance: `06f5eb6677d58410b51ce0f2f5871b6869415ea4be5b30333425bbdf4713398b`.

API/web healthy; original PostgreSQL/Redis retained. Schema54 digest:
`a797580fb5224ea85e099fe56758bbd9905f40dc6a1a24dd76dc5a71549d2ccd`.
Native coordination closure and guarded current-pointer CAS verified. The launcher
provided post-context terminal stdout plus PID absence; no process exit-code proof
is claimed. Historical receipts were retained unchanged.

## Verification

Full clean quality gate:3311PASS,111 conditional skips,0FAIL; typechecks/builds PASS.
Dedicated browser regression:1PASS. Exact private operator Linux suite64/64 with
zero skips. All required feature/release reviews and installed Version Guardian PASS.
Fresh consistent DATA archive `pre-invoice0151-fd672e07c5b8`, checksum verification
and official isolated restore/cleanup PASS. This is not a production restore/RTO claim.

Actual installed CUA confirmed brand/full snapshot and first journal0.15.1; four
builtins show the edit action. SEPA English opened with editable seller/payment
fields and JSON configuration, save enabled. Screenshot inspected; dialog closed
without saving. Console error log empty. No real template, customer, payment or
provider mutation was performed as part of acceptance.

## Retention and release isolation

Owner's updated policy is2 ordinary source sets and2 rollback sets. Existing
retention owner performed reviewed narrow cleanup. Fresh inventory:2 ordinary,
2 rollback,2 protected service/recovery source archives (raw4), API5/web5; no excess.
Backups, uploads, database and volumes were not deleted. Service archives require
an explicit dependency audit before deletion; they are not ordinary release sets.

An unrelated shared-user cron addition exposed an overly broad release check.
The corrected private operator protects the exact CRM job and effective environment;
foreign jobs are read-only audit. No other project's jobs or files were changed.
Earlier failed attempts were reconciled before the accepted native retry03. No
unfinished project-hardening source or local rehearsal executor was deployed.
