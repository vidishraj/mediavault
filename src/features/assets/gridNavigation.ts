/**
 * Pure grid-navigation core for the virtualized asset grid (Task 5).
 *
 * This is deliberately transport- and React-independent: given only the current
 * focused index and the grid geometry, it returns the next index. Keeping the
 * navigation math pure is what lets the roving-tabindex model stay correct across
 * the virtualization seam — the component layer decides *how* to focus a row that
 * may not be mounted (scroll it into view, then focus); this layer only decides
 * *which* index should hold focus next.
 *
 * Row-major flat grid: index `i` sits at row `floor(i / columns)`, column
 * `i % columns`. All results are clamped to `[0, count - 1]`; an empty grid
 * (`count === 0`) always yields `-1`.
 */

export type GridNavKey =
  | 'ArrowRight'
  | 'ArrowLeft'
  | 'ArrowDown'
  | 'ArrowUp'
  | 'Home'
  | 'End'
  | 'PageDown'
  | 'PageUp';

export interface GridGeometry {
  /** Number of items in the (filtered) collection. */
  count: number;
  /** Rendered columns per row. Must be >= 1; values < 1 are treated as 1. */
  columns: number;
  /** Rows visible in the viewport, used for PageUp/PageDown. Defaults to 1. */
  rowsPerPage?: number;
}

export interface GridNavOptions {
  /**
   * When true, Home/End jump to the first/last item in the whole grid rather
   * than the first/last item in the current row. Wire this to Ctrl (or Cmd).
   */
  toEnds?: boolean;
}

const clamp = (value: number, count: number): number =>
  count <= 0 ? -1 : Math.max(0, Math.min(value, count - 1));

/**
 * Compute the index that should receive focus after `key` is pressed while
 * `index` is focused. Returns the same (clamped) index when the move would fall
 * off an edge, so focus never leaves the grid by navigation alone.
 */
export function nextFocusIndex(
  index: number,
  key: GridNavKey,
  geometry: GridGeometry,
  options: GridNavOptions = {},
): number {
  const count = geometry.count;
  if (count <= 0) return -1;

  const columns = Math.max(1, Math.floor(geometry.columns) || 1);
  const rowsPerPage = Math.max(1, Math.floor(geometry.rowsPerPage ?? 1) || 1);
  const i = clamp(index, count);
  const row = Math.floor(i / columns);
  const rowStart = row * columns;
  const rowEnd = Math.min(rowStart + columns - 1, count - 1);

  switch (key) {
    case 'ArrowRight':
      return clamp(i + 1, count);
    case 'ArrowLeft':
      return clamp(i - 1, count);
    case 'ArrowDown':
      // Move one row down in the same column; stay put if nothing is below.
      return i + columns < count ? i + columns : i;
    case 'ArrowUp':
      return i - columns >= 0 ? i - columns : i;
    case 'Home':
      return options.toEnds ? 0 : rowStart;
    case 'End':
      return options.toEnds ? count - 1 : rowEnd;
    case 'PageDown':
      return clamp(i + columns * rowsPerPage, count);
    case 'PageUp':
      return clamp(i - columns * rowsPerPage, count);
    default:
      return i;
  }
}

/** The keys this module handles, for a quick membership test in event handlers. */
export const GRID_NAV_KEYS: ReadonlySet<string> = new Set<GridNavKey>([
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
  'PageDown',
  'PageUp',
]);

export function isGridNavKey(key: string): key is GridNavKey {
  return GRID_NAV_KEYS.has(key);
}
