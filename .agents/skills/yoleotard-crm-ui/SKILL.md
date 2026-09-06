---
name: yoleotard-crm-ui
description: Apply the current YO_crm interface language, components, tokens, responsive behavior and visual contracts. Use for CRM pages, Inbox, Orders, navigation, typography, status badges or interaction styling.
---

# Yoleotard CRM UI

Read `CONTEXT.md`, `apps/web/lib/i18n.ts`, `apps/web/components/crm-shell.tsx`,
the owning component and its imported CSS. For Inbox work also read
`.planning/phases/09-inbox-redesign/09-UI-SPEC.md` and
`docs/ui/inbox-reference-0.1.3.md`.

1. Reuse the current shell, components and CSS variables. The canonical base
   tokens are defined in `apps/web/app/styles.css`; page CSS may refine them.
2. Preserve the violet accent, light surfaces, compact high-information layout,
   consistent status badges and the unified top navigation as implemented.
3. Add user-facing Russian text through `apps/web/lib/i18n.ts`. Preserve client
   names, addresses and messages in their source language.
4. Keep keyboard access, focus visibility, semantic controls, readable minimum
   type and responsive behavior at desktop and narrow mobile widths.
5. Compare against the approved visual reference for that feature; avoid
   hardcoding a new design system in one component.
6. Add focused interaction tests when behavior changes. Validate visual layout,
   overflow and console errors in a real browser for meaningful UI work.
