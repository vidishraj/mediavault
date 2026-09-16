/**
 * The single selection model for the whole app.
 *
 * One owner of the selected-id Set (here); the grid stays props-driven and does
 * not import this store — App bridges it into the grid's props. Range/shift-click
 * math lives in the grid's kernel (it owns the anchor and the ordered rows) and
 * arrives here already resolved via `replaceWith(ids)`, so there is exactly one
 * anchor owner and one Set owner, never two.
 *
 * Rendering contract (matters for the 12,400-card budget): a card takes its
 * membership as a BOOLEAN prop — `selected={selectedIds.has(id)}` computed by the
 * container — and memoises on that boolean, so toggling one selection re-renders
 * only the affected card. Do NOT spread `isSelected` into cards: it is a STABLE
 * imperative helper for the container (it reads the latest set via a ref), not a
 * reactive per-card signal. `toggle`/`replaceWith`/`selectAll`/`clear`/`isSelected`
 * are all referentially stable across selection changes.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

/** Pure toggle, exported for testing without a React renderer. */
export function toggleInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export interface Selection {
  selectedIds: ReadonlySet<string>;
  isSelected: (id: string) => boolean;
  count: number;
  toggle: (id: string) => void;
  /** Replace the whole selection (the grid resolves a range gesture to ids). */
  replaceWith: (ids: string[]) => void;
  /** Select everything currently loaded. */
  selectAll: (orderedIds: string[]) => void;
  clear: () => void;
}

const EMPTY: ReadonlySet<string> = new Set();

export function useSelection(): Selection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY);

  // Latest set behind a ref so `isSelected` can be a genuinely stable callback
  // (empty deps) instead of a new function on every selection change.
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  const toggle = useCallback((id: string) => setSelectedIds((prev) => toggleInSet(prev, id)), []);
  const replaceWith = useCallback((ids: string[]) => setSelectedIds(new Set(ids)), []);
  const selectAll = useCallback((orderedIds: string[]) => setSelectedIds(new Set(orderedIds)), []);
  const clear = useCallback(() => setSelectedIds(EMPTY), []);
  const isSelected = useCallback((id: string) => selectedRef.current.has(id), []);

  return useMemo(
    () => ({ selectedIds, isSelected, count: selectedIds.size, toggle, replaceWith, selectAll, clear }),
    [selectedIds, isSelected, toggle, replaceWith, selectAll, clear],
  );
}
