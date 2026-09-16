import { useState } from 'react';
import { bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssetList } from '@/features/assets/useAssetList';
import { useDebouncedValue } from '@/features/assets/useDebouncedValue';
import { useUrlAssetQuery } from '@/features/assets/useUrlAssetQuery';
import { statusLabel } from '@/lib/format';
import { describeError } from '@/lib/messages';
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The URL and the input update on every keystroke (responsive, shareable), but the NETWORK query
  // uses the debounced value, so a burst of typing is one request, not one per key.
  const debouncedQ = useDebouncedValue(query.q ?? '', 250);
  const list = useAssetList({ ...query, q: debouncedQ || undefined, limit: 24 });

  const sort = query.sort ?? 'updatedAt:desc';
  const status = query.status ?? [];
  const kind = query.kind ?? [];

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkStatus(next: AssetStatus) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const result = await bulkSetStatus(ids, next);
      setNotice(`${result.applied} updated, ${result.failed} failed.`);
      setSelectedIds(new Set());
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Bulk update failed');
    }
  }

  function handleSaved(_asset: Asset) {
    // Live reconciliation is handled by the query cache; nothing to do here for now.
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={query.q ?? ''}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as NonNullable<AssetQuery['sort']>)}>
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
        <span className="muted" aria-live="polite">
          {list.status === 'loading'
            ? 'Loading…'
            : `${list.assets.length} of ${list.total.toLocaleString()} shown`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span>{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <button onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}

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
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
            onSelectRange={(ids) => setSelectedIds(new Set(ids))}
          />
        )}

        {list.status === 'error' && (
          <div className="state state--error" role="alert">
            <p>{describeError(list.error) ?? 'Could not load assets.'}</p>
            <button onClick={() => list.refetch()}>Try again</button>
          </div>
        )}

        {list.status === 'empty' && (
          <div className="empty">
            <p>Nothing matches these filters.</p>
            <p className="muted">Clear the search box or widen the filters.</p>
          </div>
        )}

        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
