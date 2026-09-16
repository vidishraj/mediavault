/**
 * Chunking and bounded-concurrency helpers.
 *
 * The API caps batch fetch at 25 ids and bulk-status at 50, so any operation
 * over a large selection must be split. And because the rate limit counts every
 * request, the split must run with BOUNDED concurrency — firing all chunks at
 * once ("40 parallel requests") is the fastest way to trip 429 and trigger the
 * retry storm the whole client is built to avoid. These primitives are the
 * substrate Task 3's bulk actions build on.
 */

import { apiErrorFromThrown } from './errors';

/** API-imposed id caps (see API.md). */
export const BATCH_FETCH_ID_CAP = 25;
export const BULK_STATUS_ID_CAP = 50;

/** Default in-flight parallelism for a chunked operation. */
export const DEFAULT_CONCURRENCY = 4;

/** Split `items` into consecutive chunks of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface MapOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Run `worker` over `items` with at most `concurrency` in flight at once,
 * returning results in input order. Fail-fast: the first worker rejection
 * rejects the whole run (a caller that wants partial results — e.g. bulk 207
 * handling — makes its own worker settle and return a result object instead of
 * throwing). Honours an `AbortSignal`.
 */
export function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  { concurrency = DEFAULT_CONCURRENCY, signal }: MapOptions = {},
): Promise<R[]> {
  return new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(items.length);
    let next = 0;
    let active = 0;
    let done = false;

    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    function onAbort() {
      finish(() => reject(apiErrorFromThrown(new DOMException('Aborted', 'AbortError'))));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    const pump = () => {
      if (done) return;
      if (next >= items.length && active === 0) {
        finish(() => resolve(results));
        return;
      }
      while (active < Math.max(1, concurrency) && next < items.length && !done) {
        const index = next;
        next += 1;
        active += 1;
        // safe: index < items.length is guaranteed by the loop condition
        Promise.resolve(worker(items[index] as T, index)).then(
          (value) => {
            results[index] = value;
            active -= 1;
            pump();
          },
          (error) => {
            active -= 1;
            finish(() => reject(error));
          },
        );
      }
    };

    pump();
  });
}
