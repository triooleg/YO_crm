# Orders workspace UI contract

## Source of truth

The supplied 2026-09-04 Orders reference image and the accompanying Russian product specification define the visual and interaction contract. This is a redesign of the live Orders workspace, not a mock route.

## Information hierarchy

1. Header: title, operational subtitle, existing new-order action.
2. Six compact, clickable KPI cards: active, deposit required, due within seven days, overdue, ready to ship, completed.
3. Search and controls: filters, quick filters, sort, columns, CSV export; active filters appear as removable chips.
4. Dense order table: controls, order/client, quantity, discipline, designs, deadline, payment, sales status, next action, delivery, created date and contextual action.
5. Every order expands in place. This single expanded workspace contains all four status dimensions, every item and its detailed measurements, finance and payment history, invoices, delivery and contacts, customer requirements and the order activity history. There is no second full-page order card.

## Visual tokens

- Existing Yoleotard purple remains the primary accent.
- Background is near-white; surfaces are white with pale violet-gray borders.
- Radius: 8-12 px for controls/cards; shadows only for overlays and image preview.
- Dense table typography: 10-13 px; key names, dates and totals use stronger weight.
- Status colors: green success, amber attention, red overdue/blocking, blue/purple workflow.
- Channel identity uses inline SVG brand marks, never emoji.

## Interaction contracts

- KPI and quick-filter controls update the same local filtered result set; filters compose with search and sort.
- Column visibility/order persists in localStorage. The source channel is part of the client cell and is not a standalone column.
- Row click does not navigate. Chevron, canonical order number and contextual action expand/collapse the same row. Explicit buttons open the client record, payment flow or measurements.
- Sales and production statuses remain editable through the audited order-status route. Payment and shipping statuses are visible but read-only; shipping changes remain owned by the shipping workflow.
- The common measurement editor is available only for individual orders. Pair and group items expose their saved snapshots without calling the server route that intentionally rejects multi-item orders.
- Deadline and status editing continue to use the existing audited API paths.
- CSV export exports the currently filtered/sorted rows and contains no hidden API request.
- Pagination is client-side over the existing bounded `GET /orders` response; changing filter/search resets to page one.

## Responsive contract

- Desktop targets: 1920x1080, 1600x900, 1440x900, 1366x768.
- At narrower widths, the table keeps a stable minimum width and scrolls horizontally inside its own surface; the document must not overflow horizontally.
- KPI and tool rows wrap; expanded cards collapse from four columns to two and then one.
- Secondary columns can be hidden through Columns; core order/client, quantity, deadline, payment and status remain available.

## Data and safety constraints

- All values come from existing API entities. No fixture values enter production code.
- Monetary values remain integer minor units and ISO currency.
- Next action and problem badges are deterministic presentation helpers only; they do not mutate state or trigger automation.
- Missing values are explicit (`Не указан`, `Нет замеров`, `—`). Existing backend enums, authorization, audit and soft-delete behavior remain unchanged.

