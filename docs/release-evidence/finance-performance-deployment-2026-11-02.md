# Finance performance 0.13.2 — installed evidence

Deployment authorized by the owner. Completed 2026-11-01 at 22:28:34 UTC
(2026-11-02 in Europe/Kyiv). Production: https://crm.yoleotard.com/.

## Delivered artifact

- Source Git commit: `6124f1768ed679e3156b0d50bb9f2b23a3a0a598`, published to `origin/main`.
- Frozen source snapshot: `adc4f992622c8ede213afa67bf309a77d94d243db8cd38f26f4da2db6def33b2` (1492 files).
- API image: `sha256:7a5223cde109207ad04aeea8b85ac41e9192f40ffdef7e0f665cbd74715e6198`.
- Web image: `sha256:1c5de6c49a7a2f49dcceba413eb9da76c1c1ed5b58892793ac4b7926591078db`.
- Both embedded artifact metadata and OCI labels report 0.13.2 and the frozen snapshot.
- Emitted Next.js server configuration agrees; BUILD_ID `uPn40RRvGDvlg6fxcKLro`.
- Authoritative Compose checksum after deployment: `4c38651295cca0c1ee48ed51a7ad61380461f5af8f9f2ccf146dbd9d536b2253`.

The documentation-only follow-up containing this report does not rebuild or
relabel these immutable artifacts. The original frozen handoff records the
preparation state; the repository handoff now records installed acceptance.

## Change and measured result

Latest tax receipt/source/lifecycle reads are batched inside the existing report
transaction. No finished financial-result cache was introduced. Financial rules,
payments, archive predicates, agreed order prices and monthly fixed ESV are
unchanged. No schema migration, seed or historical message import was performed.

| Observation | Before | Installed |
| --- | ---: | ---: |
| Overview financial report HTTP 200 | 4194 ms | 2530 ms |
| Finance switch financial report HTTP 200 | 4061 ms | 2019 ms |

These browser observations cover the full report request, including unrelated
report work and transport. They are not a repeated statistical benchmark or an
SLA. Separate same-snapshot READ ONLY database comparison measured 502 to 76 SQL
queries and 2234 to 315 ms for the affected tax-report path. Complete canonical
result hashes were identical:
`92baa7d9a238184128280a88cba736e8bcd4731b11da226fe2429383b2406dce`.
The isolated speed ratio must not be described as the whole-page speed ratio.

## Verification and recovery

- Final `pnpm quality:check`: 3085 passed, 105 optional skipped, zero failed;
  all typechecks and builds passed.
- Independent compatibility, regression, business/security, visual-contract,
  Standards/Spec and exact-artifact predeployment reviews passed.
- Operator qualification on Linux: 38 passed, zero skipped.
- Existing backup engine created consistent DATA archive
  `pre-finance-0132-adc4f992622c`; isolated recovery drill and cleanup passed,
  with workers disabled and outbound access disabled. Table fingerprints and
  985 local file references matched. No restoration touched production.
- API/web healthy, restart counts zero; PostgreSQL/Redis retained their original
  container identities. Public root and `/api/health` returned HTTP 200;
  health dependencies PostgreSQL, Redis and uploads were up.
- Browser Overview and Finance financial cards/charts loaded; brand and current
  journal entry displayed 0.13.2 with the exact snapshot. Zero new console errors.
- Earlier accumulated network captures contain eight transient HTTP 502 responses
  on background notification polling. Their exact wall-clock times were not
  retained, so they cannot be precisely attributed to cutover. A separate fresh
  Finance reload beginning 22:37:53 UTC matched 46 new requests and verified the
  report, options and background polling successfully, with zero HTTP errors or
  network failures. Earlier buffered events were explicitly excluded by request
  wall-clock time; this clean sample establishes current behavior.
- Fresh postdeployment inventory: five release source sets, five rollback sets,
  five API images and five web images; no further cleanup candidates.

A first premutation operator attempt stopped on overly strict mount-order and
probe-port checks. Independent unchanged-baseline verification preceded bounded
cancellation. The corrected, requalified operator completed cutover and verified
the installed ingress guard. No failed-attempt source/config/image installation
was carried forward.

Private receipts, raw browser measurements, screenshot and operator logs stay
outside Git in the release workspace and protected server release directory.
No credentials, customer message payloads or backup contents are published.
