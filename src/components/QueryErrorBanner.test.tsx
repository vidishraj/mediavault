// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorFromResponse } from '@/api/errors';
import { GENERIC_ERROR_TITLE } from '@/lib/messages';
import { QueryErrorBanner } from './QueryErrorBanner';

/**
 * The last gap closed at the render layer: a REAL 429 error object, built the
 * way the transport builds it (apiErrorFromResponse over the wire envelope),
 * must produce the specific rate-limited copy on the rendered surface, not the
 * generic fallback. The transport-side test pins that the error object survives
 * the hook; this pins that the surviving object yields the right words on
 * screen. Between them a collapse has nowhere to hide, and a rendered generic
 * message would fail here.
 */
describe('QueryErrorBanner: a real 429 renders the specific copy', () => {
  afterEach(cleanup);

  function real429() {
    const body = {
      error: { code: 'rate_limited', message: 'Too many requests in the last 10 seconds.' },
    };
    const response = new Response(JSON.stringify(body), {
      status: 429,
      headers: { 'retry-after': '3', 'x-request-id': 'req_test' },
    });
    return apiErrorFromResponse(response, body);
  }

  it('shows the rate-limited title (not the generic) with a Try again', () => {
    const error = real429();
    // Guard: it really is a rate_limited ApiError, not a hand-built literal.
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);

    const onRetry = vi.fn();
    render(<QueryErrorBanner error={error} onRetry={onRetry} />);

    // The rendered surface shows the specific copy...
    expect(screen.getByText('Slowing down to keep up')).toBeTruthy();
    // ...and NOT the generic fallback (the collapse the whole seam guards against).
    expect(screen.queryByText(GENERIC_ERROR_TITLE)).toBeNull();

    const retry = screen.getByRole('button', { name: /try again/i });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
