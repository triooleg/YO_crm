# Technical handoff — release 0.12.11 candidate

This public handoff describes a prepared source candidate. It does not establish production installation or acceptance. Full operational continuity and private release history remain in the canonical workspace and protected release records; they are intentionally excluded from this document.

## Source identity

- Candidate version: 0.12.11.
- Candidate snapshot SHA-256: e1e473e7918243179d0bdeecf4a0bd80b0c64f485c52e25f306f5215ef3950cb.
- Candidate archive SHA-256: 2d577a3272b20fb2bbee501afe0600261b576fe7053f310f063b1151176427c5.
- Candidate source inventory: 1,375 files.
- Accepted baseline version: 0.12.10.
- Baseline snapshot SHA-256: 074d0d5ee71f3d00e73fac2803c16859840a9b06c611b3fa304e5dcc5880972d.

The release adds contact-copy actions using existing Mantine primitives, localized clipboard feedback, responsive layout and browser regression coverage. Existing edit behavior is retained. This release increment has no API runtime, database schema or financial behavior changes.

## Publication correspondence

The publication preserves exact candidate bytes for 1,374 files, including runtime code, tests and assets. CHAT_HANDOFF.md is the sole documentation-only privacy substitution. The publication receipt records both its candidate and public SHA-256 values. Three remote-only release-evidence documents are retained. Do not describe this publication as byte-identical to all 1,375 candidate files.

EXACT_CANDIDATE_GITHUB means exact candidate source correspondence subject to the explicitly recorded CHAT_HANDOFF.md documentation privacy substitution. It is a source-publication check, not an installed-runtime acceptance claim.

## Owner policy and next gates

The owner requires GitHub current-project publication for every deployment, including service-only deployment and rollback. Publish only the reviewed accepted source and sanitized release evidence. Preserve remote-only development material unless its removal is separately justified. Never publish credentials, customer data, signed URLs, private migration artifacts or operational history.

Quality, source/security review and explicit integrator GO precede publication. The reviewed release branch is published before staging; main is fast-forwarded only after installed acceptance. No force-push. Actual deployment pins and installed verification must be recorded separately after deployment. At this handoff checkpoint, commit, push, staging and production acceptance are not asserted.
