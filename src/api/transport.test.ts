import { afterEach, describe, expect, it, vi } from 'vitest';

import { chunk, mapWithConcurrency } from './concurrency';
import { ApiError, apiErrorFromResponse, apiErrorFromThrown, parseRetryAfter } from './errors';
import { inFlightCount, request } from './http';
import { computeDelayMs, DEFAULT_RETRY, isRetryable, shouldRetry, withRetry } from './retry';

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
});
