/**
 * A single, client-wide request budget.
 *
 * The rate limit is the headline trap of this assessment: 80 requests per rolling
 * 10s, per client, and RETRIES COUNT. Per-operation bounded concurrency is not
 * enough — two chunked bulk operations plus the grid's list queries all draw on
 * ONE 80/10s budget, and a fresh per-operation limiter cannot see the others. So
 * the ceiling is enforced ONCE, centrally: every request acquires a token here
 * before it calls `fetch`, RETRIES INCLUDED (the server counts a rejected request
 * too — it pushes the timestamp before checking — so a retry that 429s still
 * spends a slot; the gate must sit in front of fetch and be impossible to route
 * around, which is why it lives inside the per-attempt path).
 *
 * It is a true SLIDING-WINDOW limiter (a timestamp deque), not a fixed window: a
 * fixed window would allow 80 at t=9.9s and 80 more at t=10.1s — 160 inside one
 * trailing 10s — while believing it complied. Every trailing 10s slice holds at
 * most `limit`.
 *
 * EXEMPT — and this must stay true: thumbnails (`/api/thumb/*`) and the SSE
 * stream (`/api/events`) are exempt SERVER-SIDE and must not consume client
 * tokens. They already bypass this layer entirely (thumbnails are plain <img>
 * URLs; SSE uses EventSource), so they never reach `request()`. Do NOT "tidy up"
 * by routing them through `request()` for consistency — that would spend budget
 * the server never charges and throttle the grid for nothing.
 */

import { abortableDelay } from './retry';

export interface Clock {
  now(): number;
}

const systemClock: Clock = { now: () => Date.now() };

export class RollingRateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  /**
   * Resolve once a slot is free within the rolling window, recording the grant.
   * Rejects (without consuming a slot) if the signal aborts while waiting, so a
   * cancelled request does not hold or spend budget.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const cutoff = now - this.windowMs;
      while (this.hits.length > 0 && (this.hits[0] as number) <= cutoff) {
        this.hits.shift();
      }
      if (this.hits.length < this.limit) {
        this.hits.push(now);
        return;
      }
      // wait just past the moment the oldest hit leaves the window
      const waitMs = (this.hits[0] as number) - cutoff + 1;
      await abortableDelay(Math.max(1, waitMs), signal);
    }
  }

  /** Test hook: how many hits are currently inside the window. */
  get windowCount(): number {
    return this.hits.length;
  }

  /** Clear the window (test isolation between cases). */
  reset(): void {
    this.hits.length = 0;
  }
}

// The server fails the request that makes the window exceed 80 (strictly `> 80`,
// so the 81st fails). We hold well below that, at 70, for real headroom: our
// clock is not the server's, requests already in flight are spent but not yet
// observable here, and the budget is per-IP (other tabs share it). Better to
// pace slightly early than to trip the ceiling and pay a 429 Retry-After — which
// would itself count against the budget and keep the window saturated.
export const RATE_LIMIT = 70;
export const RATE_WINDOW_MS = 10_000;

/**
 * The one budget the whole client shares. Declared `let` + a live ESM binding so
 * tests can swap it (a high-capacity or fake-clock limiter) without the suite
 * blocking on real refill — the same "injectable seam" the retry policy uses for
 * its RNG. Production code never reassigns it.
 */
export let rateLimiter = new RollingRateLimiter(RATE_LIMIT, RATE_WINDOW_MS);

/** Test seam: replace the shared limiter; returns a restore function. */
export function __setRateLimiter(next: RollingRateLimiter): () => void {
  const previous = rateLimiter;
  rateLimiter = next;
  return () => {
    rateLimiter = previous;
  };
}
