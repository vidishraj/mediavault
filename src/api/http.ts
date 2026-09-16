/**
 * The core request primitive: one place that talks to `fetch`, so cancellation,
 * retry, error parsing and de-duplication are uniform and cannot drift between
 * endpoints.
 *
 * - CANCELLATION is real. Every request takes an `AbortSignal`; aborting rejects
 *   with an `aborted` ApiError and stops any pending retry backoff. The brief
 *   distinguishes "cancelled" from "ignored" and this is the cancelled half.
 * - DE-DUPLICATION is reference-counted. Identical concurrent GETs share ONE
 *   underlying flight; a caller that aborts only detaches itself, and the shared
 *   request is aborted only when the LAST interested caller leaves. So a search
 *   race that fires the same URL twice makes one network call, and one component
 *   unmounting does not cancel the fetch another component is still waiting on.
 */

import { apiErrorFromResponse, apiErrorFromThrown } from './errors';
import { DEFAULT_RETRY, type RetryConfig, withRetry } from './retry';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Retry is OFF by default here because TanStack Query is the retry executor
   * for all data operations (it is configured with the shared retry predicate,
   * see ./queryClient). Retrying in both layers would multiply attempts against
   * the rate limit. Pass a config to opt a direct, non-RQ call into `withRetry`.
   */
  retry?: Partial<RetryConfig>;
  /** De-dupe identical concurrent flights. Defaults to true for GET only. */
  dedupe?: boolean;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function doFetch<T>(path: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (thrown) {
    // fetch rejects on network failure or abort; normalise both.
    throw apiErrorFromThrown(thrown);
  }
  if (!response.ok) {
    throw apiErrorFromResponse(response, await parseJson(response));
  }
  return (await parseJson(response)) as T;
}

// --- reference-counted in-flight de-duplication --------------------------

interface Flight<T> {
  promise: Promise<T>;
  controller: AbortController;
  refs: number;
}

const flights = new Map<string, Flight<unknown>>();

/**
 * Share one execution of `factory` across concurrent callers keyed by `key`.
 * Each caller's own `signal` can detach it; the underlying request is aborted
 * only when every caller has detached.
 */
function deduped<T>(key: string, factory: (signal: AbortSignal) => Promise<T>, callerSignal?: AbortSignal): Promise<T> {
  let flight = flights.get(key) as Flight<T> | undefined;
  if (!flight) {
    const controller = new AbortController();
    const created: Flight<T> = {
      controller,
      refs: 0,
      promise: factory(controller.signal).finally(() => {
        if (flights.get(key) === (created as Flight<unknown>)) flights.delete(key);
      }),
    };
    flights.set(key, created as Flight<unknown>);
    flight = created;
  }
  const current = flight;
  current.refs += 1;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const detach = () => {
      current.refs -= 1;
      if (current.refs <= 0) current.controller.abort();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      detach();
      reject(apiErrorFromThrown(new DOMException('Aborted', 'AbortError')));
    };
    if (callerSignal?.aborted) {
      onAbort();
      return;
    }
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    current.promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        callerSignal?.removeEventListener('abort', onAbort);
        current.refs -= 1;
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        callerSignal?.removeEventListener('abort', onAbort);
        current.refs -= 1;
        reject(error);
      },
    );
  });
}

/** Test-only: assert no flights leak between cases. */
export function inFlightCount(): number {
  return flights.size;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const retryConfig: RetryConfig = options.retry
    ? { ...DEFAULT_RETRY, ...options.retry }
    : { ...DEFAULT_RETRY, maxAttempts: 1 }; // no internal retry unless opted in
  const shouldDedupe = options.dedupe ?? method === 'GET';

  const run = (signal?: AbortSignal) =>
    withRetry<T>((): Promise<T> => doFetch<T>(path, method, options.body, signal), retryConfig, signal);

  if (shouldDedupe) {
    return deduped<T>(`${method} ${path}`, (signal) => run(signal), options.signal);
  }
  return run(options.signal);
}
