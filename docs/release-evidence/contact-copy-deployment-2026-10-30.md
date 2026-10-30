# Contact-copy deployment verification — 2026-10-30

## Source and publication

Version: 0.12.11. Frozen snapshot and source manifest SHA-256: e1e473e7918243179d0bdeecf4a0bd80b0c64f485c52e25f306f5215ef3950cb.
Archive SHA-256: 2d577a3272b20fb2bbee501afe0600261b576fe7053f310f063b1151176427c5.
Publication base commit: 8378b45fd1f0d6f89eae8409a349edb0f88c2499.
Baseline: 0.12.10 / 074d0d5ee71f3d00e73fac2803c16859840a9b06c611b3fa304e5dcc5880972d.

Remote verification confirmed 1,374 exact candidate blobs, one explicitly approved CHAT_HANDOFF.md privacy substitution and three preserved remote-only evidence documents. This is qualified source correspondence, not a claim that all 1,375 candidate files have identical bytes. These post-install documentation changes do not alter runtime code, tests or assets.

## Completed checks

- Frozen quality: 2,917 tests passed, 33 skipped, zero failures; typecheck and build passed.
- Focused browser checks: 20/20 passed.
- Fresh DATA backup: 454,309,037 bytes; isolated restore passed. No production database restore was performed for this validation.
- Installed engineering checks: API and web matched the candidate snapshot. API image: sha256:f856441dd06f59db98b209ba4b66e033e3b252fdc5ef69a6c7c971b86ab19c88; web image: sha256:3f6eba7f2104ecc7b42da8331eed7696a56e809a1fff70963bb063b4e13ee3d0.
- Generic read-only live checks: three viewports, search behavior, displayed version and complete snapshot identity passed.
- Contact-copy live checks: eight fields, clipboard failure/retry and editor cancel passed at 1366px and 390px. A browser Clipboard API stub was used. These checks establish UI clipboard handling, not an actual operating-system clipboard write.

No customer or contact details, screenshots, credentials or private artifact locations are included in this public evidence.

## Accepted installed state

Final installed release, version and visual reviews passed, including targeted mobile-card checks at 390px. Post-deployment retention passed with 5 rollback sets, 5 releases, 5 API images and 5 web images; no backup or volume deletion was performed by this retention check. The backup executor is resumed and AVAILABLE, with one owned cron entry, foreign cron preserved and agent settings unchanged.

Version 0.12.11 is accepted installed for the source and image pins above. The reviewed release branch and this accepted record accompany the main-branch fast-forward after installed acceptance.
