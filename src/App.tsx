import { useEffect, useRef, useState } from 'react';
import { BulkBar } from '@/components/BulkBar';
import { EmptyState } from '@/components/EmptyState';
import { OfflineBanner } from '@/components/OfflineBanner';
import { QueryErrorBanner } from '@/components/QueryErrorBanner';
import { ResultCount } from '@/components/ResultCount';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssetList } from '@/features/assets/useAssetList';
import { useDebouncedValue } from '@/features/assets/useDebouncedValue';
import { useUrlAssetQuery } from '@/features/assets/useUrlAssetQuery';
import { useBulkStatus } from '@/features/bulk/useBulkStatus';
import { useSelection } from '@/features/selection/useSelection';
import { statusLabel } from '@/lib/format';
import type { Asset, AssetKind, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: AssetKind[] = ['image', 'video', 'document'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

export function App() {
  const { query, setSearch, toggleStatus, toggleKind, setSort } = useUrlAssetQuery();
  const selection = useSelection();
  const bulk = useBulkStatus(selection.selectedIds);
  const [activeId, setActiveId] = useState<string | null>(null);

  // The URL and the input update on every keystroke (responsive, shareable), but the NETWORK query
  // uses the debounced value, so a burst of typing is one request, not one per key.
  const debouncedQ = useDebouncedValue(query.q ?? '', 250);
  const list = useAssetList({ ...query, q: debouncedQ || undefined, limit: 24 });

  const sort = query.sort ?? 'updatedAt:desc';
  const status = query.status ?? [];
  const kind = query.kind ?? [];

  // The bulk outcome deliberately SURVIVES a retry chain (a permanent failure must not vanish), so it
  // is cleared only by an explicit dismiss (BulkBar.onDismiss → reset) and whenever the SELECTION
  // CHANGES — otherwise a prior operation's banner would sit above a new selection. Keyed on the
  // selection set alone (via a ref to the latest reset) so it does NOT fire when `apply` sets the
  // outcome without changing the set, which would wipe the banner the instant it appears.
  const resetBulk = useRef(bulk.reset);
  resetBulk.current = bulk.reset;
  useEffect(() => {
    resetBulk.current();
  }, [selection.selectedIds]);

  // The grid reads membership as `selectedIds.has(id)` and never mutates it, so the store's
  // ReadonlySet passes straight through by reference — which keeps the STABLE reference the
  // 12,400-card memoisation depends on, rather than copying into a new Set each render.
  const selectedIds = selection.selectedIds;

  function handleSaved(_asset: Asset) {
    // Live reconciliation happens in the query cache (the bulk hook and the detail edit both write
    // through it); nothing to do at the App level.
  }

  return (
    <div className="app">
      <OfflineBanner />

      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          aria-label="Search assets"
          placeholder="Search assets"
          value={query.q ?? ''}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Sort order"
          value={sort}
          onChange={(e) => setSort(e.target.value as NonNullable<AssetQuery['sort']>)}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </header>

      <div className="filters">
        {STATUSES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={status.includes(s)} onChange={() => toggleStatus(s)} />
            {statusLabel(s)}
          </label>
        ))}
        <span className="filters__sep" aria-hidden="true">
          ·
        </span>
        {KINDS.map((k) => (
          <label key={k}>
            <input type="checkbox" checked={kind.includes(k)} onChange={() => toggleKind(k)} />
            {k}
          </label>
        ))}
        {list.assets.length > 0 && (
          <button
            type="button"
            className="btn-subtle"
            onClick={() => selection.selectAll(list.assets.map((a) => a.id))}
          >
            Select all {list.assets.length} loaded
          </button>
        )}
        <ResultCount loaded={list.assets.length} total={list.total} status={list.status} />
      </div>

      {(selection.count > 0 || bulk.outcome) && (
        <BulkBar
          selectedCount={selection.count}
          onApply={bulk.apply}
          onClear={selection.clear}
          outcome={bulk.outcome}
          onRetry={bulk.retryRetryable}
          canRetry={bulk.canRetry}
          onDismiss={bulk.reset}
          isApplying={bulk.isApplying}
        />
      )}

      <main className="content">
        {(list.status === 'loading' || list.status === 'ready') && (
          <AssetGrid
            assets={list.assets}
            total={list.total}
            isFirstPageLoading={list.status === 'loading'}
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            isFetchNextPageError={list.isFetchNextPageError}
            nextPageError={list.nextPageError}
            onFetchNextPage={() => void list.fetchNextPage()}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={selection.toggle}
            onOpen={setActiveId}
            onSelectRange={selection.replaceWith}
          />
        )}

        {list.status === 'error' && list.error && (
          <QueryErrorBanner error={list.error} onRetry={() => list.refetch()} />
        )}

        {list.status === 'empty' && <EmptyState />}

        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
