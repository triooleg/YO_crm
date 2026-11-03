# Durable finance reports — installed 0.14.0

Owner authorized deployment after development and publication of current source
to GitHub. Application commit `8d894ed8f106eb577274afe290bc2102bbe3922a`
was verified on origin/main before installation. This evidence-only follow-up
does not change the built application.

## Exact installed artifacts

- Source snapshot: `bff7949e067dc762bd4e03983f83ecdc9d1acf4f0afae870ce80c90b51043fc0`.
- API: `sha256:60f0802ca940802ec6bd513618a15f8c8c6fb69dd19685e3b219dee13dd7053a`.
- Web: `sha256:c6f7390de41b9dc96e25152b6bd42cf97c8fa01bfce26de7fb75bb5f214329df`.
- Plan: `8530ae292b18edf4a69b6580d0d9f34a80aae2ea4bef1e4b61f4faef1e13b764`.
- Guarded operator: `813ba17f253e3d54d6f1ce48410602599457a54e4e36b99f6b9889c16b521f68`.
- Schema: 53/NATIVE_V1, digest
  `e2a1168f0ecaf2b3f655b165c38d840dd511d5dee241aeb501a49d5cba983499`.

The operator installed 51 scoped source leaves, including one additive migration,
`20261102160000_finance_report_snapshots`. It reached
RUNTIME_GATE_VERIFIED at 00:56:08 UTC; the supervisor subsequently recorded
exit0/APPLIED. Separate read-only closure proved gate exit and released lease
and flocks. No seed, production restore, down migration, payment/order smoke
write, message send, provider refresh or proxy change was performed.

All four services are healthy. Original PostgreSQL/Redis identities, mounts and
network remain verified. Financial cache coverage is true: 18 source tables,
36 ALWAYS triggers and six checked functions. Historical ingress guard remains1.

## Verification

`pnpm quality:check` passed: API2354/web824/database65 = 3243 PASS,
109 optional SKIP, zero FAIL; typechecks and both builds passed. The final
native PostgreSQL16 suite applied all53 migrations and passed full model/CSV
comparisons, currencies, restart, five callers, pool1, changed/voided historical
receipts, selective invalidation, corruption and coverage fallback. MVCC21/21
and SQL detail ordering/filtering193 comparisons passed. Eight browser fixture
paths and six responsive screenshots passed. Independent compatibility,
regression, business/Spec, visual, version and release PREDEPLOY reviews passed.

Fresh DATA capture `pre-financeperiods-0140-bff7949e067d-v4` independently
verified stopped-writer consistency. Its standard isolated restore and final
post-shadow restore both passed real cleanup. Offline drill sourceConsistent
false is retained as such; host capture consistency is separate evidence.
No production restore time is claimed.

Canonical actual shadow qualification SHA:
`4ee55402757d32f0c8ae15528f0b4a1f942df0293ea8ac793bdb239c925ac7bb`.
It passed old52→old53 compatibility, candidate uncached/cold/restart comparisons,
old-image payment/expense/tax/monthly ROOT+FINALIZE/import-Prisma seams inside
one forced-rollback transaction, unchanged business/revision fingerprints,
schema53 cache dump/restore, restored hits and resource cleanup. No providers
or worker timers started. It does not claim an end-to-end provider import.

The new additive receipt-confirmation scalar was independently derived from
legacy full evidence; other public JSON fields and array order were compared.
Candidate uncached/cold/hit/restored CSV was compared exactly. Cross-version
CSV byte identity is not claimed: evidence JSON key ordering is canonicalized.
Earlier failed private attempts remain failed; the final successful report was
published without rewriting those attempts. One attempt reached the disposable
300s test deadline; the separately reviewed final test used a bounded600s
qualification limit. Production migration/timeouts and all financial assertions
were unchanged. The final actual cycle completed in342.56s including restore.

## Measured performance

Actual CDP browser response TTFB, November2026/EUR, six months, payments,
page1/size10, same public CRM page:

| Request | 0.13.4 reload | 0.14.0 first load | 0.14.0 repeat reload |
|---|---:|---:|---:|
| Summary | 2676.613ms | 5494.509ms | 98.692ms |
| Detail | 1815.387ms | 59.746ms | 70.422ms |

These are observed samples, not latency percentiles or isolated server time.
Baseline measurement shared a host with the isolated qualification. Initial
cache construction is more expensive; warm gains do not imply the first load
is faster. Detail now requests bounded page evidence.

On the isolated copy of real DATA, full-report uncached calls took
1361–1486ms/67 SQL reads, including46 economic source reads. Restarted durable
hits took52–95ms/23 SQL reads and zero economic source reads. Summary restart
hit took22.58ms/10 SQL reads. Actual browser Finance, FOP accruals, Overview and
sales statistics loaded without console errors; brand and first version journal
show0.14.0/full installed source. Existing Overview cash-result and Finance
after-accrual-result semantics are preserved; this performance change does not
unify those pre-existing display meanings.

## Final reconciliation

Installed technical observation and parent CUA attestation were independently
reviewed; the create-only installed proof SHA is
`583b3ad9e19c5301753a37e43d3f9ee2c59d34daa6ed80d0bd0aa5b791539453`.
Actual post-cutover retention is5 rollback roots/5 release roots/5 API images/
5 web images with no cleanup targets. No post-cutover deletion was necessary;
backups and volumes were preserved.

The stale historical deployed-snapshot pointer was reconciled only after actual
installed proof and coordination closure. Exact prior bytes/metadata and all
historical receipts were preserved. New pointer SHA:
`3d0c37c020c53baef8acf7af8020e62b92c06a01420030513fd5eae5d0c0ae11`.
The CAS rechecked actual healthy runtime/config/schema and exact prior state;
it did not change application images or restore the database. Independent
VERSION INSTALLED and FINAL RELEASE INSTALLED reviews both passed, with no
remaining blocking findings. This release is accepted as installed0.14.0.
Private technical receipts live under `.local/finance-period-deploy`; DATA,
credentials and private operational helpers are not committed.
