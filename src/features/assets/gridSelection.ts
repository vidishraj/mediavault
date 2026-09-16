/**
 * Pure range-selection core for the grid keyboard model (Task 5).
 *
 * Shift+Arrow extends a contiguous selection anchored where the last plain
 * Space/Enter/click landed. Selection state itself lives in the App shell (the
 * bulk bar acts on it); the grid owns the *anchor* and computes the ordered id
 * set for a range gesture, then hands it up via `onSelectRange(ids)`.
 *
 * This module is the pure part: given the ordered items plus the anchor and
 * focus **indices** (the grid already tracks the focus index for the roving
 * tabindex, so no O(n) id lookup is needed per keystroke), return the ids in the
 * inclusive contiguous range. Keeping it index-based keeps a Shift+Arrow sweep
 * O(range), not O(items) — this list is up to 12,400 rows.
 */

export interface HasId {
  id: string;
}

/** Normalized inclusive [start, end] for an anchor/focus pair, clamped to bounds. */
export function rangeBounds(
  anchorIndex: number,
  focusIndex: number,
  count: number,
): { start: number; end: number } | null {
  if (count <= 0) return null;
  const last = count - 1;
  const focus = Math.max(0, Math.min(focusIndex, last));
  // No valid anchor yet -> the range is just the focused item.
  const anchor =
    anchorIndex < 0 || anchorIndex > last ? focus : Math.floor(anchorIndex);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

/**
 * Ids in the inclusive contiguous range from the anchor to the focus, in list
 * order. Empty list or an out-of-range focus with an empty result yields `[]`.
 */
export function selectionRangeIds<T extends HasId>(
  items: readonly T[],
  anchorIndex: number,
  focusIndex: number,
): string[] {
  const bounds = rangeBounds(anchorIndex, focusIndex, items.length);
  if (!bounds) return [];
  const ids: string[] = [];
  for (let i = bounds.start; i <= bounds.end; i++) {
    const item = items[i];
    if (item) ids.push(item.id);
  }
  return ids;
}
