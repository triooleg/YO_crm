# Clients frontend worker integration notes

Integration status (2026-11-03): historical worker notes below describe the
standalone patch, not final acceptance. Parent has ported all legacy source
contracts and the five Mantine browser cases. Dictionary strings now live in
the existing i18n.ts barrel. Current evidence and limits are recorded in
docs/plans/clients-workspace-refresh.md and the final verification report.
The athlete form was subsequently wrapped in Mantine Modal: its old z-index 20
overlay was behind the new mobile Drawer. Submit payload is unchanged; browser
coverage verifies focus, Escape, save and return from the nested modal.

Base: c91c747. No commit, shared-file edit, deployment or real data mutation.
Ownership: client-workspace.tsx, new clients/*, new clients-workspace-i18n.ts,
and new e2e/clients-workspace.spec.ts. AddAthlete body preserved verbatim after
line-ending normalization. Existing OrderPanel/MeasurementPanel are reused.

## Parent integration seams

- Export clientsWorkspaceUi from lib/i18n.ts. The worker imports the new dictionary
  directly to remain independently buildable; parent may route these imports
  through the shared barrel after adding its export.
- Shell must forward (section, context) for orders and inbox. The e2e test tagged
  @integration exercises exact conversationId/channel/clientId/clientsReturn.
  It deliberately is not skipped in the normal main Playwright run.
- Inbox return uses returnConversationId/returnChannel retained in Clients URL.
- Optional channels[].conversationId enables direct identity-to-chat linking;
  without it source action opens the accessible conversation list, never guesses
  a conversation from a channel-scoped externalId.
- latestOrder and history items should retain optional sourceSystem,
  externalNumber, externalId for existing KeyCRM display-number semantics.
- Merge fieldChoices is {field: selectedClientId}; preview conflicts accept field
  strings or {field} objects. Server-returned normalized fieldChoices are sent
  back with previewToken. No per-source legacy merge requests are performed.
- Notes PATCH sends notes, visibility and expectedUpdatedAt; visibility starts at
  preferences.clientNoteVisibility or INTERNAL. No message/send API is called.
- Summary uses reportCurrency, orderTotalMinor/paidTotalMinor (null -> dash),
  rateDate, native grouped totals. No browser/provider FX lookup.
- The parent owns canonical CHAT_HANDOFF.md and independent review roles.

## Tests

Run `node --test apps/web/components/clients/tests/helpers.test.mjs`.
Run normal main `pnpm --filter @yoleotard-crm/web exec playwright test e2e/clients-workspace.spec.ts`.
Standalone worker config (port3521): `pnpm --filter @yoleotard-crm/web exec playwright test --config components/clients/tests/playwright.config.ts --grep-invert '@integration'`.
Synthetic fixtures are in clients/tests/fixtures.ts; screenshots use testInfo
output paths. They do not read or mutate production data.

Expanded standalone suite: 10 browser tests passed, covering five widths,
create duplicate preflight, merge token, AddAthlete payload, lazy conversations /
files, deep selection outside page, profile manager, notes visibility, unknown
currency conversion and stale client responses. Helpers: 6 pass. Subsequent global-duplicates contract has pairwise related reasons,
truncation warning and 15/20/50 pagination, including empty pages with total>0.
Conversation date uses visible lastMessageAt only; null renders a dash. Web typecheck
and production build passed; final reruns are reported in the worker response.

Full web suite currently has 808pass/29skip/17fail. Failures are old source-text
contracts and must be updated narrowly in parent; do not delete their behavior:

- add-athlete-workspace.test.mjs: preserve athlete submit/reload, stale selection
  protection, optional duplicate independence, localized errors and merge focus.
  New e2e covers submit and stale selection; preview is now explicit/lazy.
- mantine-client-controls.test.mjs: follow CreateClient/MergeClients modules;
  preserve field names, create/athlete payload, focus/Escape. Single merge and
  collapsible 220px rail were intentionally replaced by approved workspace.
- mantine-shell-primitives.test.mjs: actual Tabs is Mantine, five panels now.
- measurement-viewer.test.mjs: viewer trigger moved to client-details.tsx.
- order-context-navigation.test.mjs: context is retained in URL, passed to detail
  request, highlighted and pinned in orders if outside the page; selectors moved.
- order-number-display.test.mjs: shared orderDisplayNumber + technical title
  live in clients/orders.tsx and clients-table.tsx.
- orders-workspace.test.mjs: navigation uses contextual onNavigate callback;
  the duplicate local sidebar was removed in favor of existing global shell.
- shell-contract.test.mjs: new Russian labels are in new dictionary, not literals
  in client-workspace.tsx.

The old e2e/mantine-client-controls.spec.ts remains unchanged for parent: it mocks
legacy array GET /clients and single merge endpoints, and selects the removed
rail/tab structure. Port its create/athlete assertions using the exported fixture
and new suite, preserving their exact payload checks.

Release is NOT approved by the worker: main API/shell integration, old contract
updates, independent compatibility/regression/business/visual/release reviews,
full quality and any live smoke remain parent gates.

## Final worker verification

- Helpers6/6 PASS.
- Standalone browser10/10 PASS before final duplicates contract refinement.
- Pairwise global-duplicates paging15/20/50 and empty page / total60:1/1 PASS.
- Final responsive rerun4/4 PASS:1920x1080,1366x768,390x844,320x740,
  including mobile photo modal and Drawer Escape/return focus/no reopen.
- Final web typecheck PASS. Earlier web production build PASS; no new full build
  after the final scoped changes, as requested by parent.
- Shared next-env.d.ts generated by Next restored to its previously clean bytes.
- Stable screenshots: .local/clients-ui-visuals/clients-{width}.png.
- Final parent run includes the @integration Inbox callback test. Shell forwarding
  is intentionally parent-owned, so this worker excluded only that integration
  test from standalone runs. No hidden skip is present in the main suite.
