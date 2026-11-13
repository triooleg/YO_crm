# Clients workspace 0.15.0 deployment — 2026-11-03

Owner-authorized deployment completed. Installed technical and browser checks
pass; final independent Release Gatekeeper INSTALLED review passed.

## Installed artifact

- Application commit: `a739ed84ee79fb3058282703d2d860b9a8fa8ada`.
- Version: `0.15.0`, API and web rebuilt from the same frozen source.
- Source: `83b4d312fc6b53d3cd3dcf41b387d972c2afc51cc162f9daed70a5a77c45d35b`.
- API image: `5c47fad6841b96b214e158612c164b9c41853c7472e0f911b2d53d527f2a2363`.
- Web image: `d125db63c480a48a44d15ecc47ae988febd7cb2b330dfc3042a1d6b4de72b698`.

The Clients workspace extends existing identities, merge provenance, order
history, athletes, measurements and communications. Existing historical data
and identifiers remain; no separate customer/history store was introduced.
See [implementation verification](../plans/clients-workspace-verification-2026-11-03.md)
for the specification, visual comparison and local screenshots.

## Validation

Exact-version quality: 3304 tests passed, 110 conditional integration tests
skipped; typechecks and production builds passed. Separate browser checks
passed 25/25 and native PostgreSQL checks 15/15. Compatibility, regression,
business and visual reviews passed. Version and Release PREDEPLOY passed for
the exact admitted plan.

Fresh consistent DATA capture and the isolated official restore/cleanup passed.
Consistency is established by the separate stopped-writer capture evidence;
the offline restore engine does not claim source consistency or production RTO.
Real-DATA shadow checks passed old53, old54 and candidate54, preserving original
public row fingerprints, finance coverage and foreign keys. Temporary resources
were removed. Actual candidate merge → actual old compiled split refusal without
writes → candidate recovery of the same operation passed in one native
transaction. The old version retains its pre-existing file-merge limitations;
it does not gain new-format split support. Application rollback keeps schema54;
reversing a new-format merge requires the new implementation.

The only migration is `20261103160000_client_file_merge_routing`; exact original
DDL and its completed migration journal were applied atomically. Original
PostgreSQL/Redis containers and the existing proxy were retained. No production
restore, seed, real-client merge or customer message was performed.

Actual installed browser checks passed for the Clients table, search, selected
right card, lazy tabs, order photographs and full-image popup. The selected
client's conversation opens correctly in Inbox, and returning selects the same
client. Brand and first journal entry show 0.15.0 with the full source identity.
Browser console warnings/errors: 0. Screenshots and operational records containing
customer data remain private and are not published to GitHub.

API/web and retained PostgreSQL/Redis are healthy; domain and API health return
HTTP200. Independent Version Guardian INSTALLED PASS is recorded. Independent
closure confirms the operator PID absent and coordination locks released; no
detached-process exit-code claim is made. Existing retention inventory is
5 rollback / 5 release / 5 API / 5 web with zero excess; backups and volumes
were not pruned by this deployment.

## Acceptance receipts

- Installed runtime and actual browser proof:
  `14bc215e94e99d988245f8dbfbf1aa22c9f30012cb1b49ec824dfbda5916c577`.
- Single, OPS-reviewed pointer CAS: `CURRENT_POINTER_CAS_VERIFIED`; exact old
  bytes and metadata captured, historical receipts preserved. Receipt SHA:
  `44bcb3c3756dd2eed66ac0dc186f925ba7fecc5b6d68860083546b86e1b9e4b8`.
- Final provenance: `PROVENANCE_RECORDED`, with runtime/schema revalidation;
  SHA `b033b37f64eb7c722eed8ba3c0e0315467dfbdb4e5b13c2b1a529de5e1c9cf46`.
- Final independent Release Gatekeeper INSTALLED: PASS for the exact installed
  0.15.0 candidate after technical/browser, closure, Version Guardian, pointer
  CAS and final provenance evidence review.

These are hashes of private protected receipts, not substitutes for their
contents. Only this sanitized report and the canonical handoff are published
after application deployment; this evidence-only update does not change the
installed application artifact or version.
