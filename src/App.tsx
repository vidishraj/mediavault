import { useState } from 'react';
import { bulkSetStatus } from '@/api/client';
import { AssetDetail } from '@/features/assets/AssetDetail';
import { AssetGrid } from '@/features/assets/AssetGrid';
import { useAssets } from '@/features/assets/useAssets';
import { Banner } from '@/components/Banner';
import { StateBlock } from '@/components/StateBlock';
import { GridSkeleton } from '@/components/Skeleton';
import { statusLabel } from '@/lib/format';
import { genericFailure, summarizeBulk, type UserMessage } from '@/lib/messages';
import type { Asset, AssetStatus, AssetQuery } from '@/lib/types';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const SORTS: Array<{ value: NonNullable<AssetQuery['sort']>; label: string }> = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'sizeBytes:desc', label: 'Largest first' },
  { value: 'createdAt:desc', label: 'Newest' },
];

export function App() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<AssetStatus[]>([]);
  const [sort, setSort] = useState<NonNullable<AssetQuery['sort']>>('updatedAt:desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [flash, setFlash] = useState<UserMessage | null>(null);

  // Every keystroke sends a request. Nothing is debounced or cancelled.
  const { items, total, loading, error } = useAssets({ q, status, sort, limit: 24 });

  const filtersActive = q.trim() !== '' || status.length > 0;
  // Until the data layer surfaces a typed error code, any fetch failure maps to
  // an offline-aware generic message rather than the leaked server string.
  const listError = error ? genericFailure() : null;

  function clearFilters() {
    setQ('');
    setStatus([]);
  }

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
    setFlash(null);
    try {
      // Sends every selected id in one call, which the API refuses above 50.
      const result = await bulkSetStatus(ids, next);
      setFlash({
        title: summarizeBulk(result.applied, result.failed),
        tone: result.failed > 0 ? 'warn' : 'info',
        retryable: false,
      });
      setSelectedIds(new Set());
    } catch {
      setFlash(genericFailure());
    }
  }

  function handleSaved(_asset: Asset) {
    // The list is not told that anything changed, so it shows stale rows.
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>MediaVault</h1>
        <input
          className="search"
          type="search"
          placeholder="Search assets"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
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
            <input
              type="checkbox"
              checked={status.includes(s)}
              onChange={(e) =>
                setStatus((prev) =>
                  e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                )
              }
            />
            {statusLabel(s)}
          </label>
        ))}
        <span className="muted">
          {loading ? 'Loading…' : `${items.length} of ${total.toLocaleString()} shown`}
        </span>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulkbar">
          <span className="bulkbar__count">{selectedIds.size} selected</span>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => applyBulkStatus(s)}>
              Set {statusLabel(s).toLowerCase()}
            </button>
          ))}
          <span className="bulkbar__spacer" />
          <button className="btn-subtle" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {flash && <Banner message={flash} onDismiss={() => setFlash(null)} />}
      {/* A fetch error while results are still on screen: a strip, not a takeover. */}
      {listError && items.length > 0 && <Banner message={listError} />}

      <main className="content">
        {listError && items.length === 0 ? (
          <StateBlock variant="error" title={listError.title} body={listError.body} />
        ) : loading && items.length === 0 ? (
          <GridSkeleton />
        ) : items.length === 0 ? (
          <StateBlock
            variant="empty"
            title={filtersActive ? 'No assets match these filters' : 'No assets yet'}
            body={
              filtersActive
                ? 'Try a broader search, or clear a filter to see more.'
                : 'Assets you add will show up here.'
            }
            action={
              filtersActive ? (
                <button className="btn-subtle" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <AssetGrid
            assets={items}
            selectedIds={selectedIds}
            activeId={activeId}
            onToggleSelect={toggleSelect}
            onOpen={setActiveId}
          />
        )}
        {activeId && (
          <AssetDetail id={activeId} onClose={() => setActiveId(null)} onSaved={handleSaved} />
        )}
      </main>
    </div>
  );
}
