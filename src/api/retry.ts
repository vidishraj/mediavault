/**
 * Retry policy, expressed as a predicate over the error taxonomy.
 *
 * The decision to retry is STRUCTURAL — set membership on `ApiError.code` — never
 * a string match on a message. Task 4 requires exactly this: a 503 and a 409 are
 * told apart by their code, so rewording a message can never change whether we
 * retry.
 *
 * The rate limit is the designed trap: 80 requests / rolling 10s, and RETRIES
 * COUNT. A naive "retry 3x immediately" turns one 503 into four requests and
 * pushes the whole app toward 429, which then also retries — a storm that makes
 * things strictly worse. Three things stop that here: attempts are CAPPED, the
 * backoff uses FULL JITTER so concurrent failures do not resynchronise, and a
 * server `Retry-After` is HONOURED (a 429 waits its 3s instead of hammering).
 */

import { ApiError, type ErrorCode } from './errors';

/**
 * The only codes we retry. From API.md:
 *  - upstream_unavailable (503): transient, Retry-After: 2
 *  - rate_limited (429): back off, Retry-After: 3
 *  - write_failed (500): explicitly "safe to retry" (the write did not apply)
 *  - network_error: the request never reached the server
 *
 * Everything else is terminal by design: 400 (bad_request / stale_cursor /
 * bad_cursor / too_many_ids), 409 version_conflict (must refetch), 422
 * (invalid_* / legal_hold), 404, aborted, and unknown — retrying any of these
 * just wastes a slice of the rate-limit budget on a request that cannot succeed.
 */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'upstream_unavailable',
  'rate_limited',
  'write_failed',
  'network_error',
]);

export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && RETRYABLE_CODES.has(error.code);
}

export interface RetryConfig {
  /** Total attempts including the first. 3 = one try + two retries. */
  maxAttempts: number;
  /** Base backoff before jitter, doubled each attempt. */
  baseDelayMs: number;
  /** Ceiling on any single backoff. */
  maxDelayMs: number;
  /** Injectable for deterministic tests; defaults to Math.random. */
  random: () => number;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 8000,
  random: Math.random,
};

/**
 * Delay before the retry that follows `attempt` (0-indexed: 0 = after the first
 * try). Full jitter — `random(0, capped exponential)` — so a burst of failures
 * spreads out instead of retrying in lockstep. A server `Retry-After` is a floor
 * we must respect; we add a little jitter on top so honouring it does not itself
 * create a synchronised second wave.
 */
export function computeDelayMs(attempt: number, error: ApiError | null, config: RetryConfig = DEFAULT_RETRY): number {
  const exponential = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** attempt);
  const jittered = config.random() * exponential;
  const retryAfter = error?.retryAfterMs ?? null;
  if (retryAfter != null) {
    // honour the server's floor, plus jitter up to one base interval
    return retryAfter + config.random() * config.baseDelayMs;
  }
  return jittered;
}

export function shouldRetry(error: unknown, attempt: number, config: RetryConfig = DEFAULT_RETRY): boolean {
  return attempt + 1 < config.maxAttempts && isRetryable(error);
}

/** Reject-on-abort sleep, so a cancelled request stops waiting immediately. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `attempt()` with the retry policy. `attempt` receives the 0-indexed try
 * number and must throw an `ApiError`. Rethrows the last error when the attempts
 * are exhausted or the error is terminal.
 */
export async function withRetry<T>(
  attempt: (tryIndex: number) => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < config.maxAttempts; i += 1) {
    try {
      return await attempt(i);
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error, i, config)) throw error;
      await abortableDelay(computeDelayMs(i, error as ApiError, config), signal);
    }
  }
  throw lastError;
}
