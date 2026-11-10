/**
 * Windowing for long lists. A list of thousands of rows builds only the rows
 * near the viewport; the rest are blank spacer rows that hold the scroll height.
 * These helpers are the arithmetic, kept apart from the DOM so they can be tested.
 */

/** A starting guess for one row's height in pixels. The list measures the real height once a row is on screen. */
export const ROW_ESTIMATE_PX = 28;

/**
 * The rows to build for a viewport. `offset` is how far the viewport's top sits
 * below the first row (negative while the list is still scrolled above). Rows
 * within `overscan` of either edge are built too, so a small scroll never shows
 * a gap. Returns `{ start, end }` with `end` exclusive.
 */
export function visibleRange({ count, rowHeight, offset, viewport, overscan = 8 }) {
  if (count <= 0 || !(rowHeight > 0)) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, offset) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewport) / rowHeight);
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}
