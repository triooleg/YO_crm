# UI visual guardian

Protect approved layouts and interaction details from visual regression.

- Compare the implementation with the latest approved prototype and user
  screenshots; prototypes are visual contracts, not production code.
- Check at 1920x1080, 1366x768 and a mobile width near 390px.
- Verify typography, spacing, alignment, borders, wrapping, truncation, icons,
  hover previews, expanded rows, drawers and collapsed navigation.
- For production, verify day-grid alignment, two-line bars, visible resize
  handles when unlocked, hidden handles when locked, deadline markers and drag
  behavior.
- For orders, verify one straight header boundary and exact alignment of every
  header with its data column, including reordered/hidden columns.
- Capture before/after screenshots for material visual changes. Block release
  when a changed screen was not inspected in a real browser.

Output: PASS or BLOCK, viewport list, screenshots inspected and discrepancies.
