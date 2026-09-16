import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GridNavKey,
  isGridNavKey,
  nextFocusIndex,
  reconcileFocusIndex,
} from './gridNavigation';
import { rangeBounds } from './gridSelection';

const RANGE_KEYS = new Set<GridNavKey>(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']);

export interface RovingGridFocusArgs {
  /** Ordered ids of the LOADED assets — focus lives within these, never on a skeleton row. */
  itemIds: readonly string[];
  columns: number;
  rowsPerPage: number;
  /** virtualizer.scrollToIndex over ROW indices; a row may be unmounted, so scroll first. */
  scrollRowIntoView: (rowIndex: number) => void;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSelectRange: (ids: string[]) => void;
}

export interface RovingGridFocus {
  focusedIndex: number;
  focusedId: string | null;
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Ref callback per rendered card; the grid focuses a row once it mounts. */
  registerRef: (id: string, el: HTMLElement | null) => void;
  /** Roving tabindex: 0 for the focused cell, -1 for the rest. */
  tabIndexFor: (index: number) => 0 | -1;
  /** Pointer entry point: clicking a card moves roving focus (and the anchor) to it. */
  focusFromPointer: (index: number) => void;
  /** Sync roving state to a card that received focus by any means, without scrolling. */
  syncFocus: (index: number) => void;
}

/**
 * Roving-tabindex focus model for the virtualised grid. All index math is done by
 * the pure kernels (nextFocusIndex / rangeBounds / reconcileFocusIndex); this hook
 * owns the React state, the keyboard handler, the selection anchor, and — the one
 * genuinely virtualisation-specific part — focusing a row that is not yet in the
 * DOM: scroll it into view, then focus it when it registers on mount.
 */
export function useRovingGridFocus({
  itemIds,
  columns,
  rowsPerPage,
  scrollRowIntoView,
  onOpen,
  onToggleSelect,
  onSelectRange,
}: RovingGridFocusArgs): RovingGridFocus {
  const count = itemIds.length;
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [focusedId, setFocusedId] = useState<string | null>(itemIds[0] ?? null);

  const anchorRef = useRef(0);
  const rowEls = useRef(new Map<string, HTMLElement>());
  const pendingFocusId = useRef<string | null>(null);

  // Latest values for the stable keydown handler (empty-dep useCallback below).
  const state = useRef({ focusedIndex, itemIds, columns, rowsPerPage, count });
  state.current = { focusedIndex, itemIds, columns, rowsPerPage, count };

  const focusIndex = useCallback((index: number) => {
    const ids = state.current.itemIds;
    if (ids.length === 0) return;
    const clamped = index < 0 ? 0 : index >= ids.length ? ids.length - 1 : index;
    const id = ids[clamped]!;
    setFocusedIndex(clamped);
    setFocusedId(id);
    scrollRowIntoView(Math.floor(clamped / state.current.columns));
    const el = rowEls.current.get(id);
    if (el) el.focus();
    else pendingFocusId.current = id; // focus on mount (registerRef)
  }, [scrollRowIntoView]);

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      rowEls.current.set(id, el);
      if (pendingFocusId.current === id) {
        el.focus();
        pendingFocusId.current = null;
      }
    } else {
      rowEls.current.delete(id);
    }
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const s = state.current;
      const key = e.key;
      const idx = s.focusedIndex;
      const id = s.itemIds[idx];
      if (id === undefined) return;

      if (key === 'Enter') {
        e.preventDefault();
        onOpen(id);
        return;
      }
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        onToggleSelect(id);
        anchorRef.current = idx;
        return;
      }
      if (isGridNavKey(key)) {
        e.preventDefault();
        const ni = nextFocusIndex(
          idx,
          key as GridNavKey,
          { count: s.count, columns: s.columns, rowsPerPage: s.rowsPerPage },
          { toEnds: e.ctrlKey || e.metaKey },
        );
        if (e.shiftKey && RANGE_KEYS.has(key as GridNavKey)) {
          const b = rangeBounds(anchorRef.current, ni, s.count);
          if (b) onSelectRange(s.itemIds.slice(b.start, b.end + 1));
          focusIndex(ni); // anchor stays put while extending
        } else {
          anchorRef.current = ni; // a plain move re-anchors
          focusIndex(ni);
        }
      }
    },
    [focusIndex, onOpen, onToggleSelect, onSelectRange],
  );

  const focusFromPointer = useCallback(
    (index: number) => {
      anchorRef.current = index;
      focusIndex(index);
    },
    [focusIndex],
  );

  // Reconcile when the result set changes (filter removes the focused row, a page
  // appends, an SSE tick patches data): focus follows the same id, or clamps to a
  // real neighbour — never a detached node.
  useEffect(() => {
    const ni = reconcileFocusIndex(focusedId, focusedIndex, itemIds);
    if (ni !== focusedIndex) setFocusedIndex(ni < 0 ? 0 : ni);
    setFocusedId(ni < 0 ? null : itemIds[ni]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemIds]);

  const syncFocus = useCallback((index: number) => {
    const ids = state.current.itemIds;
    if (index < 0 || index >= ids.length) return;
    setFocusedIndex(index);
    setFocusedId(ids[index]!);
    anchorRef.current = index;
  }, []);

  const tabIndexFor = useCallback(
    (index: number): 0 | -1 => (index === focusedIndex ? 0 : -1),
    [focusedIndex],
  );

  return {
    focusedIndex,
    focusedId,
    onKeyDown,
    registerRef,
    tabIndexFor,
    focusFromPointer,
    syncFocus,
  };
}
