# Tracking notifications: visual verification

2026-10-27. Independent visual role: PASS for the verified scope.

Actual Inbox at 1920×1080, 1366×768 and 390×844 was captured on local loopback with every API response synthetic and external requests denied. Baseline and final data are identical. Mobile controls measure 43.75 px, close icon 40 px, message text 14 px; composer text survives preview → synthetic send → close. Final network check: 38 synthetic API requests, no unknown API/external requests or browser errors.

| Width | Before | After | Preview |
| --- | --- | --- | --- |
| 1920 | [before](inbox-before-1920.png) | [after](inbox-after-1920.png) | [preview](inbox-preview-1920.png) |
| 1366 | [before](inbox-before-1366.png) | [after](inbox-after-1366.png) | [preview](inbox-preview-1366.png) |
| 390 | [before](inbox-before-390.png) | [after](inbox-after-390.png) | [preview](inbox-preview-390.png) |

Unknown/partial success: [mobile top](guardian-unknown-390-top.png), [mobile bottom](guardian-unknown-390-bottom.png). URL editor: [mobile with real root scale](url-editor-lg-root14-390.png).

Named limit: the URL-editor component was verified with the real theme/root scale; the entire OrderDelivery parent context was not visually exercised. Source placement was reviewed. No installed production UI or provider delivery was tested.

[Independent reviewer details](independent-visual-review.md). PNG identity manifest: screenshots-sha256.json.
