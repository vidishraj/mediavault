// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorFromResponse, type ApiError } from '@/api/errors';
import { GENERIC_ERROR_TITLE } from '@/lib/messages';
import { useAssetList, type AssetListResult } from '@/features/assets/useAssetList';
import { App } from './App';

/**
 * The composed-in-App counterpart to QueryErrorBanner.test.tsx. That test pins the
 * component in isolation; this one pins the whole App: when the list query fails
 * with a REAL 429 ApiError (built the way the transport builds it), the composed
 * surface must route it through QueryErrorBanner and render the specific
 * rate-limited copy - not a generic fallback, and the Try again must be wired to
 * the query's own refetch. Only useAssetList is mocked, and only to inject the
 * error state; every other hook and component in the tree is the real one, so
 * this exercises the actual composition (error -> banner, grid excluded), not a
 * stand-in for it.
 */
vi.mock('@/features/assets/useAssetList', () => ({ useAssetList: vi.fn() }));

function real429(): ApiError {
  const body = {
    error: { code: 'rate_limited', message: 'Too many requests in the last 10 seconds.' },
  };
  const response = new Response(JSON.stringify(body), {
    status: 429,
    headers: { 'retry-after': '3', 'x-request-id': 'req_test' },
  });
  return apiErrorFromResponse(response, body);
}

function errorState(error: ApiError, refetch: () => void): AssetListResult {
  return {
    assets: [],
    total: 0,
    status: 'error',
    error,
    fetchNextPage: () => Promise.resolve(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    nextPageError: null,
    refetch,
  };
}

function renderApp() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return render(<App />, { wrapper });
}

describe('App: a failed list query renders the specific copy on the composed surface', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('routes a real 429 through QueryErrorBanner (specific copy, not generic) with retry wired to refetch', () => {
    const error = real429();
    // Guard: it really is a rate_limited ApiError, not a hand-built literal.
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);

    const refetch = vi.fn();
    vi.mocked(useAssetList).mockReturnValue(errorState(error, refetch));

    renderApp();

    // The composed App shows the specific rate-limited copy...
    expect(screen.getByText('Slowing down to keep up')).toBeTruthy();
    // ...and NOT the generic fallback (the collapse the whole seam guards against).
    expect(screen.queryByText(GENERIC_ERROR_TITLE)).toBeNull();

    // The Try again is wired to the query's own refetch (the composed onRetry seam).
    const retry = screen.getByRole('button', { name: /try again/i });
    retry.click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
