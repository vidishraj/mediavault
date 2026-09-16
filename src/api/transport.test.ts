import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chunk, mapWithConcurrency } from './concurrency';
import { ApiError, apiErrorFromResponse, apiErrorFromThrown, parseRetryAfter } from './errors';
import { __setRateLimiter, RollingRateLimiter } from './rateLimiter';
import { chunkedHelperOptions } from './queryClient';
import { inFlightCount, request } from './http';
import { computeDelayMs, DEFAULT_RETRY, isRetryable, shouldRetry, withRetry } from './retry';

// Swap the shared limiter for an effectively unlimited one so request-based
// tests measure logic, not real token refill. The sliding-window test below
// builds its OWN limiter, so it is unaffected by this.
let restoreLimiter: () => void;
beforeEach(() => {
  restoreLimiter = __setRateLimiter(new RollingRateLimiter(1_000_000, 10_000));
});
afterEach(() => {
  restoreLimiter();
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('error taxonomy', () => {
  it('parses code, status, request-id and retry-after from a failure', () => {
    const res = json(503, { error: { code: 'upstream_unavailable', message: 'warming up' } }, {
      'x-request-id': 'req-1',
      'retry-after': '2',
    });
    const err = apiErrorFromResponse(res, { error: { code: 'upstream_unavailable', message: 'warming up' } });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('upstream_unavailable');
    expect(err.status).toBe(503);
    expect(err.requestId).toBe('req-1');
    expect(err.retryAfterMs).toBe(2000);
  });

  it('marks a non-error-shaped body as unknown but keeps the status', () => {
    const err = apiErrorFromResponse(json(500, 'oops'), 'oops');
    expect(err.code).toBe('unknown');
    expect(err.status).toBe(500);
  });

  it('separates abort from network failure', () => {
    expect(apiErrorFromThrown(new DOMException('Aborted', 'AbortError')).code).toBe('aborted');
    expect(apiErrorFromThrown(new TypeError('failed to fetch')).code).toBe('network_error');
  });

  it('parseRetryAfter handles seconds', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('retry predicate', () => {
  const err = (code: string, status = 0) => new ApiError({ code: code as never, status, message: '' });

  it('retries only transient codes, structurally', () => {
    for (const code of ['upstream_unavailable', 'rate_limited', 'write_failed', 'network_error']) {
      expect(isRetryable(err(code))).toBe(true);
    }
    for (const code of ['bad_request', 'stale_cursor', 'version_conflict', 'legal_hold', 'invalid_name', 'aborted', 'unknown']) {
      expect(isRetryable(err(code))).toBe(false);
    }
  });

  it('caps attempts', () => {
    expect(shouldRetry(err('rate_limited'), 0)).toBe(true);
    expect(shouldRetry(err('rate_limited'), DEFAULT_RETRY.maxAttempts - 1)).toBe(false);
  });

  it('honours Retry-After as a floor', () => {
    const e = new ApiError({ code: 'rate_limited', status: 429, message: '', retryAfterMs: 3000 });
    const delay = computeDelayMs(0, e, { ...DEFAULT_RETRY, random: () => 0 });
    expect(delay).toBeGreaterThanOrEqual(3000);
  });

  it('full jitter stays within the capped exponential', () => {
    const cfg = { ...DEFAULT_RETRY, random: () => 1 };
    expect(computeDelayMs(0, null, cfg)).toBeLessThanOrEqual(cfg.baseDelayMs);
    expect(computeDelayMs(10, null, cfg)).toBeLessThanOrEqual(cfg.maxDelayMs);
  });

  it('withRetry retries a transient error then succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new ApiError({ code: 'upstream_unavailable', status: 503, message: '' });
        return 'ok';
      },
      { ...DEFAULT_RETRY, baseDelayMs: 0, random: () => 0 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('withRetry does not retry a terminal error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new ApiError({ code: 'version_conflict', status: 409, message: '' });
      }, { ...DEFAULT_RETRY, baseDelayMs: 0 }),
    ).rejects.toMatchObject({ code: 'version_conflict' });
    expect(calls).toBe(1);
  });
});

describe('chunking and bounded concurrency', () => {
  it('chunks to the cap', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('preserves order and never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const worker = async (n: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    };
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], worker, { concurrency: 2 });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('fails fast on a worker rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }, { concurrency: 3 }),
    ).rejects.toThrow('boom');
  });

  it('rejects immediately on an already-aborted signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(mapWithConcurrency([1], async (n) => n, { signal: ctrl.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});

describe('in-flight de-duplication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one flight for identical concurrent GETs', async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return json(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      request('/api/assets?q=x'),
      request('/api/assets?q=x'),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(inFlightCount()).toBe(0); // no leak
  });

  it('does not de-duplicate different URLs', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([request('/api/assets?q=x'), request('/api/assets?q=y')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('one caller aborting leaves the shared flight alive for the others', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((res) => {
      resolveFetch = res;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const ctrlA = new AbortController();
    const a = request('/api/assets?q=z', { signal: ctrlA.signal });
    const b = request('/api/assets?q=z'); // attaches to the same flight
    ctrlA.abort(); // A detaches; B is still interested

    await expect(a).rejects.toMatchObject({ code: 'aborted' });
    resolveFetch(json(200, { shared: true }));
    await expect(b).resolves.toEqual({ shared: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // never a second flight
    expect(inFlightCount()).toBe(0); // and no leak
  });
});

describe('abort cancels a pending backoff', () => {
  it('does not run the next attempt once aborted mid-backoff', async () => {
    const ctrl = new AbortController();
    let attempts = 0;
    const p = withRetry(
      async () => {
        attempts += 1;
        throw new ApiError({ code: 'upstream_unavailable', status: 503, message: '' });
      },
      { ...DEFAULT_RETRY, baseDelayMs: 8000, random: () => 1 }, // long backoff we will interrupt
      ctrl.signal,
    );
    await new Promise((r) => setTimeout(r, 5)); // let the first attempt fail and enter the delay
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1); // the second attempt never fired
  });
});

describe('unknown-code status fallback', () => {
  it('retries an unknown code only on a transient status', () => {
    expect(isRetryable(new ApiError({ code: 'unknown', status: 503, message: '' }))).toBe(true);
    expect(isRetryable(new ApiError({ code: 'unknown', status: 400, message: '' }))).toBe(false);
  });
});

describe('double-retry guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A stand-in for a chunked helper (getAssetsByIds / bulkSetStatus): it opts
  // into the transport's own retry (up to 3 attempts) on a retryable failure.
  const chunkedHelper = () =>
    request('/api/chunked', { retry: { ...DEFAULT_RETRY, baseDelayMs: 0, random: () => 0 } });

  // Mirror createQueryClient's retry predicate, but with zero delay so the test
  // does not sleep. This is the same predicate the app uses.
  const testClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: { retry: (failureCount, error) => isRetryable(error) && failureCount < DEFAULT_RETRY.maxAttempts, retryDelay: () => 0 },
      },
    });

  it('a chunked helper wired with chunkedHelperOptions fires only the transport attempts', async () => {
    const fetchMock = vi.fn(async () =>
      json(503, { error: { code: 'upstream_unavailable', message: '' } }, { 'retry-after': '0' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const qc = testClient();
    await expect(
      qc.fetchQuery({
        queryKey: ['chunked'],
        queryFn: () => chunkedHelper(),
        ...chunkedHelperOptions, // retry: false — the guard under test
      }),
    ).rejects.toBeInstanceOf(ApiError);

    // Transport's own 3 attempts, NOT 3 (transport) x 3 (RQ) = 9.
    expect(fetchMock).toHaveBeenCalledTimes(DEFAULT_RETRY.maxAttempts);
  });
});

describe('rate limiter — true sliding window, strict > limit', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('80 fit in a window but the 81st waits until the window slides', async () => {
    vi.useFakeTimers();
    let now = 9900;
    const limiter = new RollingRateLimiter(80, 10_000, { now: () => now });

    // 80 grants at t=9900 all succeed
    for (let i = 0; i < 80; i += 1) await limiter.acquire();
    expect(limiter.windowCount).toBe(80);

    // At t=10100 all 80 are still inside the trailing 10s window [100, 10100].
    // A FIXED window would reset and allow this; a sliding window must not.
    now = 10100;
    let granted = false;
    const pending = limiter.acquire().then(() => {
      granted = true;
    });
    await Promise.resolve();
    expect(granted).toBe(false); // the 81st is refused-by-waiting

    // Slide past the original batch (t - 9900 > 10000) and let the backoff fire.
    now = 19902;
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(granted).toBe(true);
  });
});
