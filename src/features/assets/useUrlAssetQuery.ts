import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetKind, AssetQuery, AssetStatus } from '@/lib/types';
import type { AssetListQuery } from './useAssetList';

type Sort = NonNullable<AssetQuery['sort']>;

const STATUSES: readonly AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];
const KINDS: readonly AssetKind[] = ['image', 'video', 'document'];
const SORTS: readonly Sort[] = [
  'updatedAt:desc',
  'updatedAt:asc',
  'name:asc',
  'name:desc',
  'sizeBytes:desc',
  'createdAt:desc',
];
const DEFAULT_SORT: Sort = 'updatedAt:desc';

function parseEnumList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const allow = new Set<string>(allowed);
  // Unknown values are dropped, not passed to the API — a shared link cannot inject a bad filter.
  return raw.split(',').map((s) => s.trim()).filter((s) => allow.has(s)) as T[];
}

/** Pure: read a query out of a URL search string. Unknown sort falls back to the default. */
export function parseQueryFromSearch(search: string): AssetListQuery {
  const p = new URLSearchParams(search);
  const q = p.get('q')?.trim() ?? '';
  const status = parseEnumList(p.get('status'), STATUSES);
  const kind = parseEnumList(p.get('kind'), KINDS);
  const tag = (p.get('tag') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sortRaw = p.get('sort');
  const sort = SORTS.includes(sortRaw as Sort) ? (sortRaw as Sort) : DEFAULT_SORT;
  return {
    ...(q ? { q } : {}),
    ...(status.length ? { status } : {}),
    ...(kind.length ? { kind } : {}),
    ...(tag.length ? { tag } : {}),
    sort,
  };
}

/** Pure: serialize a query to a URL search string (`''` when it is just the default view). */
export function serializeQueryToSearch(query: AssetListQuery): string {
  const p = new URLSearchParams();
  if (query.q) p.set('q', query.q);
  if (query.status?.length) p.set('status', [...query.status].join(','));
  if (query.kind?.length) p.set('kind', [...query.kind].join(','));
  if (query.tag?.length) p.set('tag', [...query.tag].join(','));
  if (query.sort && query.sort !== DEFAULT_SORT) p.set('sort', query.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function toggle<T>(list: readonly T[] | undefined, value: T): T[] {
  const set = new Set(list ?? []);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  return [...set];
}

export interface UrlAssetQuery {
  query: AssetListQuery;
  /** Typing: replaceState, so a whole typing burst is ONE Back step, not one per keystroke. */
  setSearch: (q: string) => void;
  /** Committed, discrete filter changes: pushState, so Back/Forward walks meaningful views. */
  toggleStatus: (status: AssetStatus) => void;
  toggleKind: (kind: AssetKind) => void;
  setSort: (sort: Sort) => void;
  setTags: (tags: string[]) => void;
}

/**
 * Query state (q, status, kind, tag, sort) lives in the URL, so reload and share restore the exact
 * view. The write strategy is split by the kind of change: continuous editing (typing q) REPLACES
 * the current history entry so Back is not polluted by every keystroke, while a discrete committed
 * change (a status/kind toggle, a sort, a tag set) PUSHES a new entry so Back/Forward moves between
 * distinct views. The cursor is deliberately absent — it is bound to a query and would go stale.
 */
export function useUrlAssetQuery(): UrlAssetQuery {
  const [query, setQuery] = useState<AssetListQuery>(() =>
    parseQueryFromSearch(window.location.search),
  );

  // Keep the latest query in a ref so the setters can be stable and never read a stale closure.
  const queryRef = useRef(query);
  queryRef.current = query;

  // Back/Forward navigation re-reads the URL as the source of truth.
  useEffect(() => {
    const onPopState = () => setQuery(parseQueryFromSearch(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const write = useCallback((next: AssetListQuery, mode: 'push' | 'replace') => {
    const url = `${window.location.pathname}${serializeQueryToSearch(next)}`;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    setQuery(next);
  }, []);

  const setSearch = useCallback(
    (q: string) => {
      const { q: _drop, ...rest } = queryRef.current;
      write(q ? { ...rest, q } : rest, 'replace');
    },
    [write],
  );

  const toggleStatus = useCallback(
    (status: AssetStatus) => {
      const next = toggle(queryRef.current.status, status);
      const { status: _drop, ...rest } = queryRef.current;
      write(next.length ? { ...rest, status: next } : rest, 'push');
    },
    [write],
  );

  const toggleKind = useCallback(
    (kind: AssetKind) => {
      const next = toggle(queryRef.current.kind, kind);
      const { kind: _drop, ...rest } = queryRef.current;
      write(next.length ? { ...rest, kind: next } : rest, 'push');
    },
    [write],
  );

  const setSort = useCallback(
    (sort: Sort) => write({ ...queryRef.current, sort }, 'push'),
    [write],
  );

  const setTags = useCallback(
    (tags: string[]) => {
      const { tag: _drop, ...rest } = queryRef.current;
      write(tags.length ? { ...rest, tag: tags } : rest, 'push');
    },
    [write],
  );

  return { query, setSearch, toggleStatus, toggleKind, setSort, setTags };
}
