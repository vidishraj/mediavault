import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listAssets } from '@/api/client';
import type { ApiError } from '@/api/errors';
import type { Asset, AssetPage, AssetQuery } from '@/lib/types';

/** The query fields that define a result set. The cursor is deliberately NOT one of them. */
export type AssetListQuery = Omit<AssetQuery, 'cursor'>;

export type AssetListStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface AssetListResult {
  /** Flat, append-only within a query; a stable reference between renders when unchanged. */
  assets: Asset[];
  /** Full filtered count from the server (not the loaded count) — reserve scroll height from it. */
  total: number;
  /** Three distinct states, never conflated. `loading` is the FIRST page only. */
  status: AssetListStatus;
  /** The whole-query error (only with status === 'error'); the raw ApiError, never a string. */
  error: ApiError | null;
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  /** Incremental fetch in flight — the grid shows "loading more", not a full skeleton. */
  isFetchingNextPage: boolean;
  /** A next-page fetch failed. The loaded rows are kept; the grid offers a retry. */
  isFetchNextPageError: boolean;
  /** The next-page error (only with isFetchNextPageError); the raw ApiError. */
  nextPageError: ApiError | null;
  refetch: () => void;
}

/**
 * The query identity used as the TanStack Query key. Arrays are copied and sorted so that
 * ['approved','draft'] and ['draft','approved'] are the SAME key (order is not a new result set),
 * and the cursor is excluded entirely: changing any of these fields mints a new key, which starts a
 * fresh query from page one. That is what makes pagination reset on any query change, and what makes
 * a stale cursor (stale_cursor / bad_cursor) unreachable — an old cursor is never carried across a
 * query boundary.
 */
export function assetListQueryKey(query: AssetListQuery) {
  return [
    'assets',
    {
      q: query.q ?? '',
      status: [...(query.status ?? [])].sort(),
      kind: [...(query.kind ?? [])].sort(),
      tag: [...(query.tag ?? [])].sort(),
      collectionId: query.collectionId ?? null,
      owner: query.owner ?? null,
      sort: query.sort ?? 'updatedAt:desc',
      limit: query.limit ?? 24,
    },
  ] as const;
}

/**
 * The asset list, fetched page by page. Correctness is structural, not defensive:
 *
 *  - Rendering is keyed on the query, so a response for a SUPERSEDED query can never be written into
 *    the current view. The baseline's "apply whatever resolves last" race cannot occur.
 *  - The query function receives an AbortSignal from the transport layer, so a superseded query's
 *    request is genuinely CANCELLED, not merely ignored — it stops consuming the rate budget too.
 *  - The cursor lives only in pageParam, never in the key, so any query change resets pagination and
 *    no stale cursor is ever sent.
 */
export function useAssetList(query: AssetListQuery): AssetListResult {
  const result = useInfiniteQuery({
    queryKey: assetListQueryKey(query),
    queryFn: ({ pageParam, signal }) =>
      listAssets({ ...query, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AssetPage) => lastPage.nextCursor ?? undefined,
  });

  // Append-only flatten, memoised on the pages reference so the array identity is stable between
  // renders when nothing changed (the virtualiser must not re-measure needlessly).
  const assets = useMemo(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data?.pages],
  );

  const total = result.data?.pages[0]?.total ?? 0;

  const status: AssetListStatus = result.isPending
    ? 'loading'
    : result.isError
      ? 'error'
      : assets.length === 0
        ? 'empty'
        : 'ready';

  return {
    assets,
    total,
    status,
    error: result.isError ? (result.error as ApiError) : null,
    fetchNextPage: () => result.fetchNextPage(),
    hasNextPage: result.hasNextPage,
    isFetchingNextPage: result.isFetchingNextPage,
    isFetchNextPageError: result.isFetchNextPageError,
    nextPageError: result.isFetchNextPageError ? (result.error as ApiError) : null,
    refetch: () => {
      void result.refetch();
    },
  };
}
