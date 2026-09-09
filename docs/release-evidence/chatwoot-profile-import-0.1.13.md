# Chatwoot profile import 0.1.13 — visual evidence

## Scope

Settings → Каналы связи → Chatwoot profile synchronization on commit
`2e4cd16`.

## Browser verification

Command:
`playwright test e2e/chatwoot-profile-settings.spec.ts`

Result: 3 passed.

The browser test verifies at every viewport:

- the synchronization action is visible, enabled and contained in the viewport;
- there is no document-level horizontal overflow;
- while the request is pending, the button exposes `aria-busy="true"` and
  displays `Синхронизация…`;
- after completion, the result status displays the scanned, matched and updated
  client counts;
- no browser console errors are emitted.

## Direct screenshot inspection

The primary release operator inspected all three final screenshots on
2026-09-09. The Chatwoot card, fields, success status and both actions remain
legible and unclipped. On mobile, actions stack to the available width. On
desktop and laptop, the existing two-column fields and action row remain
aligned. No overlapping or inaccessible controls were found.

Artifacts are generated locally under the ignored `apps/web/test-results`
directory:

- `chatwoot-settings-1920x1080.png` — SHA-256
  `6EF6BE4F912606A74B0B25D66BF1060A9921DA23A7E56A931C122A26E193587E`;
- `chatwoot-settings-1366x768.png` — SHA-256
  `92BFD22038AD826E4CE9D5E89D84F15B967C7A2F4D6BD8AFA9B00AF18CBB858A`;
- `chatwoot-settings-390x844.png` — SHA-256
  `97264013FE21DF601AB0B0713ED4F1A41761D2B3F87FE4687C26E52627B5A337`.

The screenshots contain mocked integration settings and no production customer
data or credentials.
