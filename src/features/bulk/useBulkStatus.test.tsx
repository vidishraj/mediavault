// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Asset, AssetStatus, BulkResult } from '@/lib/types';
import { useBulkStatus } from './useBulkStatus';

// Mock only the network call; the cache logic under test is real.
vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  bulkSetStatus: vi.fn(),
}));
import { bulkSetStatus } from '@/api/client';

const mockBulk = vi.mocked(bulkSetStatus);

function asset(id: string, status: AssetStatus, version = 1): Asset {
  return {
    id, name: id, kind: 'image', status, tags: [], collectionId: 'c', owner: { id: 'u', name: 'U' },
    sizeBytes: 1, width: 1, height: 1, durationSec: null, createdAt: '', updatedAt: '', version, hasThumbnail: true,
  };
}

function seededClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(['assets', {}], {
    pages: [{ items: [asset('a', 'draft'), asset('b', 'draft'), asset('c', 'draft')], total: 3, nextCursor: null }],
    pageParams: [undefined],
  });
  return qc;
}

const statusById = (qc: QueryClient): Record<string, AssetStatus> => {
  const data = qc.getQueryData(['assets', {}]) as { pages: { items: Asset[] }[] };
  return Object.fromEntries(data.pages.flatMap((p) => p.items).map((x) => [x.id, x.status]));
};

describe('useBulkStatus', () => {
  it('keeps successes, reverts failures, reconciles versions, and RETAINS permanents across a retry', async () => {
    const qc = seededClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);

    // Run 1: a ok, b legal_hold (permanent), c conflict (retryable)
    mockBulk.mockResolvedValueOnce({
      applied: 1,
      failed: 2,
      results: [
        { id: 'a', ok: true, asset: asset('a', 'approved', 2) },
        { id: 'b', ok: false, code: 'legal_hold' },
        { id: 'c', ok: false, code: 'conflict' },
      ],
    } satisfies BulkResult);

    const { result } = renderHook(() => useBulkStatus(new Set(['a', 'b', 'c'])), { wrapper });
    act(() => result.current.apply('approved'));
    await waitFor(() => expect(result.current.outcome).not.toBeNull());

    expect(result.current.outcome!.succeededIds).toEqual(['a']);
    expect(result.current.outcome!.retryableIds).toEqual(['c']);
    expect(result.current.outcome!.permanentIds).toEqual(['b']);

    // successes keep the new status; failures reverted
    expect(statusById(qc)).toMatchObject({ a: 'approved', b: 'draft', c: 'draft' });
    // MAJOR 1: the succeeded asset's authoritative version is written to the detail cache
    expect(qc.getQueryData<Asset>(['asset', 'a'])?.version).toBe(2);

    // Run 2: retry ONLY the retryable subset
    mockBulk.mockResolvedValueOnce({
      applied: 1,
      failed: 0,
      results: [{ id: 'c', ok: true, asset: asset('c', 'approved', 2) }],
    } satisfies BulkResult);

    act(() => result.current.retryRetryable());
    await waitFor(() => expect(result.current.outcome!.succeededIds).toContain('c'));

    // MAJOR 2 regression: the legal_hold failure is STILL reported after the retry
    expect(result.current.outcome!.permanentIds).toEqual(['b']);
    expect(result.current.outcome!.retryableIds).toEqual([]);
    expect(result.current.outcome!.succeededIds.sort()).toEqual(['a', 'c']);

    // the retry re-sent ONLY the conflict id, never legal_hold
    expect(mockBulk).toHaveBeenCalledTimes(2);
    expect(mockBulk.mock.calls[1]?.[0]).toEqual(['c']);
  });
});
