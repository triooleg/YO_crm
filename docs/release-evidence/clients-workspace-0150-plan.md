# Clients workspace 0.15.0 deployment plan

Owner explicitly authorized deployment after local acceptance on 2026-11-03.
Standing instruction requires current application source on GitHub at deployment.
No GitHub Release or immutable version tag is requested.

Fresh preflight identifies installed API/web 0.14.1, source
189e4bcc4ab5d6af11d1f6398bb351b4b602ee2e6cbb2e3c7f0ff223b417f29a,
API b5fc3b0c8ea81f9d0486654c2fcf9e085154345d215228a312eb6f568f2fb052,
web 317494dc9bd6c13e02ec889b06c4d00f39c8d21362b4f14c64053d72ebfb222b.
All four services are healthy; schema53 digest
e2a1168f0ecaf2b3f655b165c38d840dd511d5dee241aeb501a49d5cba983499.
PostgreSQL/Redis and Nginx Proxy Manager remain in place.

Candidate is 0.15.0 (compatible feature MINOR), rebuilt API and web with a full
frozen source identifier. The only additional migration is
20261103160000_client_file_merge_routing. Exact schema53 prefix, original DDL
checksum and schema54 inventory must be bound in the reviewed operator.
Migration and completed journal entry share one transaction. Existing finance
coverage and writer coordination remain enforced. No seed, down migration,
production restore or customer messaging is part of release smoke.

Use existing backup, runtime-gate, transport and retention owners. Require fresh
quiesced DATA plus isolated restore/cleanup proof, old-image compatibility with
schema54, reviewed exact artifacts, Version Guardian and Release Gatekeeper PASS
before cutover. Preserve business data and at most five releases/rollback sets
and API/web versions through the existing retention owner. No backup deletion
is authorized by this plan. Application rollback retains the additive schema.

Local acceptance evidence is in ../plans/clients-workspace-verification-2026-11-03.md.
Exact-version quality and frozen artifact evidence remain pending at plan creation.
This document is a plan, not proof of an installed release.
