---
status: resolved
created: 2026-09-04
resolved: 2026-09-04
scope: communications video upload and Chatwoot inbound identity
---

# Short video attachments and Chatwoot customer identity

## Symptoms

- A 5.3 MB MP4 selected in the CRM failed with `data must be shorter than or equal to 7200000 characters`.
- Chatwoot showed `Nicola.Faccioli`, while the CRM retained the generated contact name `delicate-pond-188`.

## Root cause

- The browser sends attachment bytes as a base64 data URL. A 5.3 MB binary MP4 exceeds the old DTO ceiling of 7,200,000 characters after base64 expansion.
- The attachment allowlists, byte validation and provider payload builders handled images and documents but not outbound MP4 video consistently.
- Incoming Chatwoot normalization preferred the stale conversation contact over the sender attached to the incoming message, and the safe name-upgrade rule recognized only Facebook/Instagram placeholders.

## Fix

- Added one bounded MP4 contract: `video/mp4`, maximum 16 MiB, canonical base64 data URL and ISO-BMFF `ftyp` signature validation.
- Raised JSON parsing to 24 MiB only on `/api/communications/attachments`; the global 8 MiB limit remains unchanged.
- Added video preview and localized validation in the composer, multipart MP4 delivery to Chatwoot, video attachment delivery to Meta and a native WhatsApp Cloud API `video` payload.
- Incoming Chatwoot messages now prefer their own sender identity. Existing names are upgraded only when the stored name is a recognized technical placeholder; maintained names are preserved.

## Verification

- Failing-first coverage reproduced the 5.3 MB base64 failure, WhatsApp document misclassification and stale Chatwoot sender preference.
- Targeted communication and Orders suites: 144 tests PASS.
- Full `pnpm quality:check`: API 320/320, database 7/7, complete web suite, typechecks and production builds PASS.
- `git diff --check`: PASS.
- Production deployment and live provider smoke remain pending explicit release authorization.

