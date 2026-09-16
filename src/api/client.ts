/**
 * Typed API client built on the transport layer.
 *
 * Every method takes an `AbortSignal` so callers can genuinely cancel. GETs are
 * de-duplicated. Retry ownership is split on purpose: SINGLE-REQUEST methods
 * (listAssets, getAsset, updateAsset) do not retry here — TanStack Query owns
 * their retry. The CHUNKED helpers (getAssetsByIds, bulkSetStatus) own their
 * retry at the chunk level (re-request only the failed chunk), so a caller MUST
 * wire them with `retry: false` in RQ or attempts would multiply against the
 * rate limit. Batch and bulk are chunked to their id caps and run with bounded
 * concurrency so a large selection cannot fan out into a request storm.
 */

import type { Asset, AssetPage, AssetQuery, BulkResult } from '@/lib/types';
import {
  BATCH_FETCH_ID_CAP,
  BULK_STATUS_ID_CAP,
  chunk,
  DEFAULT_CONCURRENCY,
  mapWithConcurrency,
} from './concurrency';
import { ApiError } from './errors';
import { DEFAULT_RETRY } from './retry';
import { request } from './http';

export interface CallOptions {
  signal?: AbortSignal;
}

export interface BulkOptions extends CallOptions {
  concurrency?: number;
}

function toSearchParams(query: AssetQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status?.length) params.set('status', query.status.join(','));
  if (query.kind?.length) params.set('kind', query.kind.join(','));
  if (query.tag?.length) params.set('tag', query.tag.join(','));
  if (query.collectionId) params.set('collectionId', query.collectionId);
  if (query.owner) params.set('owner', query.owner);
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  return params.toString();
}

export function listAssets(query: AssetQuery, options: CallOptions = {}): Promise<AssetPage> {
  return request<AssetPage>(`/api/assets?${toSearchParams(query)}`, { signal: options.signal });
}

export function getAsset(id: string, options: CallOptions = {}): Promise<Asset> {
  return request<Asset>(`/api/assets/${id}`, { signal: options.signal });
}

export interface BatchResult {
  items: Asset[];
  missing: string[];
}

/**
 * Fetch many assets by id, chunked at the 25-id cap and run with bounded
 * concurrency, then merged. Chunk requests opt into the retry policy so a single
 * transient 503 does not lose a whole chunk.
 */
export async function getAssetsByIds(ids: string[], options: BulkOptions = {}): Promise<BatchResult> {
  if (ids.length === 0) return { items: [], missing: [] };
  const chunks = chunk(ids, BATCH_FETCH_ID_CAP);
  const pages = await mapWithConcurrency(
    chunks,
    (part) =>
      request<BatchResult>(`/api/assets/batch?ids=${part.join(',')}`, {
        signal: options.signal,
        retry: DEFAULT_RETRY,
      }),
    { concurrency: options.concurrency ?? DEFAULT_CONCURRENCY, signal: options.signal },
  );
  return {
    items: pages.flatMap((p) => p.items),
    missing: pages.flatMap((p) => p.missing),
  };
}

export function updateAsset(
  id: string,
  version: number,
  patch: Partial<Pick<Asset, 'name' | 'status' | 'tags'>>,
  options: CallOptions = {},
): Promise<Asset> {
  // No internal retry: a mutation's retry (write_failed only) is TanStack Query's
  // job, so a 409/422 is surfaced immediately for the caller to resolve.
  return request<Asset>(`/api/assets/${id}`, {
    method: 'PATCH',
    body: { version, patch },
    signal: options.signal,
  });
}

/**
 * Apply a status to many assets, chunked at the 50-id cap with bounded
 * concurrency, merged into one partial-success result. A chunk that fails at the
 * transport level (e.g. an exhausted 503) is folded back into per-id failures so
 * the merged result still accounts for EVERY id — Task 3 can then show exactly
 * which assets did not change and why.
 */
export async function bulkSetStatus(
  ids: string[],
  status: Asset['status'],
  options: BulkOptions = {},
): Promise<BulkResult> {
  if (ids.length === 0) return { results: [], applied: 0, failed: 0 };
  const chunks = chunk(ids, BULK_STATUS_ID_CAP);
  const partials = await mapWithConcurrency(
    chunks,
    async (part): Promise<BulkResult> => {
      try {
        return await request<BulkResult>('/api/assets/bulk-status', {
          method: 'POST',
          body: { ids: part, status },
          signal: options.signal,
          retry: DEFAULT_RETRY,
        });
      } catch (error) {
        if (error instanceof ApiError && error.isAborted) throw error;
        const code = error instanceof ApiError ? error.code : 'unknown';
        const message = error instanceof Error ? error.message : 'Request failed.';
        return {
          applied: 0,
          failed: part.length,
          results: part.map((id) => ({ id, ok: false as const, code, message })),
        };
      }
    },
    { concurrency: options.concurrency ?? DEFAULT_CONCURRENCY, signal: options.signal },
  );
  return partials.reduce<BulkResult>(
    (acc, p) => ({
      applied: acc.applied + p.applied,
      failed: acc.failed + p.failed,
      results: acc.results.concat(p.results),
    }),
    { results: [], applied: 0, failed: 0 },
  );
}

export const thumbnailUrl = (id: string): string => `/api/thumb/${id}.svg`;
