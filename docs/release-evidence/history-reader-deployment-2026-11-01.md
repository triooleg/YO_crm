# Archive Inbox reader — release 0.12.12

Date: 2026-11-01 (Europe/Kyiv). Source implementation commit:
`b509feaa41febfa89e20a027397774fbeb75197f`.

## Artifact identity

- Frozen source manifest SHA256:
  `ba0c6f92be5241b342a30a1f5b36d2af893dd385985707a37071ae94071a7801`.
- Source archive SHA256:
  `00bf2caef4f349034cde409ed379897dd379e0586176d121605f56d7359fddac`.
- API image:
  `sha256:71ae949612f0e6f2d385bf34f51137551efbfbddb46d190851cf046260e298b2`.
- Web image:
  `sha256:65b00d7676e46281f48c88c9ceb7e86ee02d9a50ed001ecc5cc3cda458900c90`.

The release contains 1,380 source files, 11 changes over accepted 0.12.11.
Public Git blobs match 1,379 candidate files exactly; CHAT_HANDOFF.md is the sole
approved public technical substitution. Private operational history is excluded.
Remote-only accepted documentation is preserved. Source manifest, Git commit and
Git publication tree are separate identities and must not be conflated.

## Changes and compatibility

The Inbox reader retains every source-dialogue precedence constraint inside equal
minute timestamps before selecting its latest 300 messages. Cycles or excessive
ties fail closed. Existing scopes, reaction/deletion/dedup filters, ordinary
message ordering, reply hydration and response shapes remain compatible.

The existing Mantine Inbox adds original minute-level source time and text-only
unavailable attachment inventory. Repeated missing slots are retained. No expired
source URL is presented as a downloadable file.

No historical writer, history module registration, migrations, schema, seed,
payment, financial calculation, authorization or provider-send changes are shipped.
This release does not import any historical conversations or assert complete
source extraction/media recovery. Operational migration remains a separate gate.

## Verification

- Exact-candidate quality: 2,926 PASS, 33 opt-in SKIP, zero failures; typecheck and
  production build PASS.
- Local synthetic archive UI: 1920, 1366 and 390 pixels; missing slots, long
  filenames, outbound contrast and ordinary message presentation PASS.
- Installed API/web image pins, labels, embedded metadata, health version and full
  source snapshot reconcile. PostgreSQL/Redis containers are retained; 49 installed
  migrations, no migrations or production database restore performed.
- Public root and API health return 200. Read-only live Inbox (44 existing messages)
  and order search/clear/pagination/logo/release-journal probes pass at 1920/1366/390,
  with zero new console/page/HTTP errors and no browser mutation requests sent.
- Fresh DATA backup, isolated restore drill and cleanup PASS. Backup freshness is
  checked from capture start, including rejection of future timestamps.
- Existing retention owner confirms maximum five release caches, rollback roots,
  API images and web images. Backup archives and data volumes were not deleted.
- Owned backup executor resumed once; foreign cron entries and settings preserved.

Independent compatibility, regression, business/security and visual reviews pass.
Version guardian passes for local, predeploy and installed scopes. Final installed
release acceptance is recorded privately; customer screenshots and backup/session
artifacts are intentionally absent from this public report.
