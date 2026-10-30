# Orders, tracking and finance: local implementation, 2026-10-27

Status: PASS_LOCAL_ONLY. All required review gates passed. No deployment, commit, push, production writes
or real customer messages. Version is unchanged (0.12.2).

## Requested behavior

Orders filters close on outside click/touch and retain values. Source selection
stays inside the Mantine click boundary.

Delivery links derive from the saved waybill. The user edits only the language;
Global supports Ukrainian and English, Nova Poshta Ukrainian. The sidebar and
parcel use the same server-generated choices. Strict HTTPS, official-host,
exact-number, path and duplicate/extra-parameter checks remain enforced.
Legacy international Nova Poshta imports with PC…NPG use the verified Global
route without changing the stored carrier. Existing URL-only PUT remains valid.

Tracking removal is a separate, explicit OWNER/ADMIN operation under an order
lock and tracking revision check. It clears the parcel number and URL plus only
matching primary legacy copies. It preserves statuses, dispatch/delivery facts,
financial values and all notification/audit history. An audit failure rolls back
the operation. Existing number/carrier edits clear the old bound URL; edits to
other shipment fields preserve the chosen language. No message is sent by these
controls. A failed refresh after a committed mutation offers a read-only retry.

Payment actions directly open the existing cancellation reason dialog through
the existing callback, with the same red outline circle-X icon as carrier
expenses. Existing canVoid/RBAC remains. Cancellation comments show the reason
without repeating its date. Position editing uses a pencil and the same editor.
Client delivery in the summary opens the existing shipment form, including
parcel selection for multiple parcels; selection/closing is blocked while save
is pending. Existing financial calculation and FX snapshots remain untouched.

Expense EUR equivalents are display-only and use the existing ensure-current
rate path. Rational rates and integer rounding preserve stored original minor
amounts. Missing, stale, unsupported or invalid rates produce a dash, not zero.

The whole Client tab was removed after the user's explicit reply. Its source,
language, client-since, order count and purchase total moved to the Details client
card using the same calculation. Contacts/source/language occupy the left
column; registration/purchase statistics occupy the right. Mantine SimpleGrid
collapses to one column at mobile widths. Client data itself is retained.

## Official carrier evidence

- https://nova.global/ua-ua/track/ — Ukrainian Global tracking.
- https://nova.global/en-ua/track/ — English Global tracking.
- https://nova.global/_next/static/chunks/3525-ed1519cdd92e3938.js — verified route construction.
- https://tracking.novaposhta.ua/ and official app JS — Ukrainian native route;
  English native route was not confirmed and is not offered as a new choice.

Only bare official pages/scripts were inspected. No customer waybill was sent.

## Validation

- Outside-click bug reproduced in a mounted browser before the fix; green after.
- Official Global alias rejection reproduced in the actual helper before fix.
- Old URL surviving number change reproduced through actual ShippingService
  updateShipment before fix; 50 runtime tests pass after correction.
- ShipmentNotificationService: 77 tests pass, including role/revision/scope,
  primary/non-primary/mismatching projections, archived scope, audit rollback,
  generated language URL and preview without provider dispatch.
- Display-only equivalent test covers UAH, USD, EUR, zero, half-cent rounding,
  missing/stale/invalid rates. Source amounts are unchanged.
- Updated existing eight-tab contract assertions to match explicit tab removal.
- Full `pnpm quality:check`: PASS, exit 0 (`quality-accepted.log`). API:
  1,999 passed / 8 opt-in skipped; web: 672 passed / 12 opt-in skipped;
  database package: 28 passed. No failures.
- The final isolated mobile tracking touch-size adjustment was then verified
  with its mounted browser test, web typecheck and web production build (exit 0).
- Outside-click, tracking controls and expanded Finance/Delivery mounted browser
  suites all PASS separately at widths 1920, 1366 and 390. Touch-size assertions
  verify the tracking Select/Save/Cancel and payment action are at least 43 px.
- `git diff --check` for affected tracked files: PASS.
- Compatibility/Standards PASS; Regression PASS; Business/security/Spec PASS.
  Local visual PASS (all three widths; 43.75 px mobile tracking targets).
  Release gatekeeper: PASS_LOCAL_ONLY, 11/11 candidate hashes verified.

## Browser evidence

Synthetic localhost browser harnesses mount the actual production components,
Mantine theme and CSS. No production API/provider requests.

- .local/order-filter-outside/browser: widths 1920, 1366, 390; outside click/tap,
  source option selection, saved values, trigger toggling and clear filters PASS.
- .local/tracking-controls/browser: language editor at all three widths; read-only
  URL, persisted-number binding, language-only payload, PUT/DELETE + failed
  refresh retries without repeating the mutation; replacement identity PASS.
- .local/expense-cancellation/browser: Details, Finance and Delivery at the same
  widths. Exact payment ID/reason/order revision callback, no action for voided
  payment, reason-only comment, EUR equivalent, client delivery form and pending
  multiparcel save protection. Final rerun PASS provides final screenshots, including cropped finance actions.

Live carrier result pages, actual customer message delivery and production
installation remain outside this local verification. No database migrations or
financial rule changes were introduced.

## Final review receipt

All required roles passed: compatibility/Standards (Euclid), regression
(Halley), business/security/Spec (Dalton), visual (Lovelace), final local release
gate (Heisenberg). No blocking findings remain. Candidate hashes are in
.local/tracking-controls/candidate-manifest.json. Version is unchanged; no
Version Guardian/deployment gate was triggered. No deployment, commit, push,
production financial mutation or customer notification was performed.
