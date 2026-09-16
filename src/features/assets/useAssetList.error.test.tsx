// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '@/lib/messages';
import { useAssetList } from './useAssetList';

/**
 * The object-survives-the-chain check. A copy table that is correct in isolation, and a hook that
 * compiles, together still do NOT prove that a real ApiError reaches the copy layer intact: a single
 * flatten anywhere in transport → RQ → this hook → describeError would compile, keep every other test
 * green, and silently degrade EVERY message to the generic one. So this drives an actual 429 through
 * the real transport and the real useAssetList, and asserts the human 429 copy comes out — not the
 * generic fallback.
 *
 * MUTATION CHECK: if useAssetList flattened its error (e.g. returned `new Error(String(result.error))`
 * instead of passing the ApiError through), `error.code` would be undefined, describeError would fall
 * through to 'Something went wrong', and both assertions below would fail.
 */
describe('a 429 surfaces as the rate-limited copy, not the generic', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves the ApiError code through the hook so describeError yields the 429 message', async () => {
    // The exact wire shape the frozen server sends on a 429: the error envelope plus Retry-After.
    const body = JSON.stringify({
      error: { code: 'rate_limited', message: '429: Too many requests in the last 10 seconds.' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '3' },
          }),
      ),
    );

    // retry:false so the single 429 settles as an error immediately (RQ owns list retry in the app;
    // here we only care that the error object survives, not the retry policy).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useAssetList({ q: 'studio' }), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('error'));

    // transport 429 → ApiError{code:'rate_limited'} → useAssetList.error (passthrough) → describeError.
    expect(result.current.error?.code).toBe('rate_limited');
    expect(describeError(result.current.error)).toBe('Slowing down to keep up');
    expect(describeError(result.current.error)).not.toBe('Something went wrong');

    client.clear();
  });
});
