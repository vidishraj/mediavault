import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/Skeleton';
import { describeError } from '@/lib/messages';
import type { Asset } from '@/lib/types';
import { AssetCard } from './AssetCard';
import { useRovingGridFocus } from './useRovingGridFocus';

/** Must match the .card height in CSS so real rows replace skeletons with no reflow. */
const ROW_HEIGHT = 104;
// Wider minimum column so the asset name — the primary identifier when scanning —
// keeps enough room to render its distinguishing suffix beside the thumbnail
// rather than truncating it. Fewer, wider columns is a deliberate trade of density
// for legibility; virtualisation keeps the extra rows free to scroll.
const MIN_CARD_WIDTH = 320;

export interface AssetGridProps {
  assets: Asset[];
  total: number;
  isFirstPageLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  nextPageError: unknown;
  onFetchNextPage: () => void;
  // Read-only by contract: the grid only tests membership (`selectedIds.has`) and
  // reads `.size`, never mutating. Typing it ReadonlySet lets the caller pass the
  // selection store's set by reference — preserving the stable identity the card
  // memoisation depends on — without the type implying the grid may corrupt it.
  selectedIds: ReadonlySet<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onSelectRange: (ids: string[]) => void;
}

function useColumns(scrollRef: React.RefObject<HTMLElement>) {
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () =>
      setCols(Math.max(1, Math.floor(el.clientWidth / MIN_CARD_WIDTH)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);
  return cols;
}

export function AssetGrid(props: AssetGridProps) {
  const {
    assets,
    total,
    isFirstPageLoading,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    nextPageError,
    onFetchNextPage,
    selectedIds,
    activeId,
    onToggleSelect,
    onOpen,
    onSelectRange,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);
  const columns = useColumns(scrollRef);

  const loadedCount = assets.length;
  const displayCount = Math.max(total, loadedCount);
  const totalRows = Math.ceil(displayCount / columns);
  const rowsPerPage = Math.max(
    1,
    Math.floor((scrollRef.current?.clientHeight ?? ROW_HEIGHT * 6) / ROW_HEIGHT),
  );

  const virtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  const itemIds = useMemo(() => assets.map((a) => a.id), [assets]);

  const scrollRowIntoView = useCallback(
    (rowIndex: number) => virtualizer.scrollToIndex(rowIndex, { align: 'auto' }),
    [virtualizer],
  );

  const focus = useRovingGridFocus({
    itemIds,
    columns,
    rowsPerPage,
    scrollRowIntoView,
    onOpen,
    onToggleSelect,
    onSelectRange,
  });

  // Roving tabindex follows focus wherever it lands (e.g. a click), without scrolling.
  const onFocusCapture = useCallback(
    (e: React.FocusEvent) => {
      const cell = (e.target as HTMLElement).closest('[data-index-id]');
      const id = cell?.getAttribute('data-index-id');
      if (id) {
        const idx = itemIds.indexOf(id);
        if (idx !== -1) focus.syncFocus(idx);
      }
    },
    [focus, itemIds],
  );

  // Infinite scroll: when a rendered row reaches into not-yet-loaded territory, fetch.
  const virtualRows = virtualizer.getVirtualItems();
  const lastRowIndex = virtualRows.length ? virtualRows[virtualRows.length - 1]!.index : 0;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isFetchNextPageError) return;
    if ((lastRowIndex + 1) * columns >= loadedCount) onFetchNextPage();
  }, [
    lastRowIndex,
    columns,
    loadedCount,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    onFetchNextPage,
  ]);

  // Live region: announce selection count changes (grid-owned; result count + bulk are shell-owned).
  const [liveMsg, setLiveMsg] = useState('');
  const selCount = selectedIds.size;
  const prevSel = useRef(selCount);
  useEffect(() => {
    if (selCount !== prevSel.current) {
      setLiveMsg(selCount === 0 ? 'Selection cleared' : `${selCount} selected`);
      prevSel.current = selCount;
    }
  }, [selCount]);

  if (isFirstPageLoading) {
    return (
      <div className="grid-scroll" ref={scrollRef} aria-busy="true">
        <div
          className="grid-row grid-row--skeletons"
          style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        >
          {Array.from({ length: columns * 6 }, (_, i) => (
            <Skeleton key={i} className="card card--skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div
        role="grid"
        aria-label="Assets"
        aria-rowcount={totalRows}
        aria-colcount={columns}
        className="grid-inner"
        style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
        onKeyDown={focus.onKeyDown}
        onFocusCapture={onFocusCapture}
      >
        {virtualRows.map((vr) => {
          const rowStart = vr.index * columns;
          return (
            <div
              key={vr.key}
              role="row"
              className="grid-row"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${vr.start}px)`,
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
              }}
            >
              {Array.from({ length: columns }, (_, c) => {
                const i = rowStart + c;
                if (i >= displayCount) return null;
                if (i >= loadedCount) {
                  return (
                    <div key={i} role="gridcell" className="card card--skeleton" aria-hidden="true">
                      <Skeleton className="card__thumb" />
                    </div>
                  );
                }
                const asset = assets[i]!;
                return (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    selected={selectedIds.has(asset.id)}
                    active={activeId === asset.id}
                    tabIndex={focus.tabIndexFor(i)}
                    onOpen={onOpen}
                    onToggleSelect={onToggleSelect}
                    registerRef={focus.registerRef}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {isFetchingNextPage && (
        <p className="grid-more" aria-hidden="true">
          Loading more…
        </p>
      )}
      {isFetchNextPageError && (
        <div className="grid-more grid-more--error" role="alert">
          <span>{describeError(nextPageError) ?? 'Could not load more.'}</span>
          <button type="button" onClick={onFetchNextPage}>
            Retry
          </button>
        </div>
      )}

      <div className="sr-only" aria-live="polite" role="status">
        {liveMsg}
      </div>
    </div>
  );
}
