import { useEffect, useState } from 'react';

/**
 * A trailing debounce: returns `value` only after it has stopped changing for `delayMs`.
 *
 * This is the rate-budget half of search (correctness is handled separately by query-keyed
 * fetching + cancellation). The 80-request / rolling-10s ceiling counts every call including
 * retries; typing a six-character query un-debounced is six requests in about a second (measured
 * on the baseline). A 250 ms trailing debounce collapses a burst of keystrokes into ONE request at
 * the pause, and it is below the ~300 ms threshold where a delay starts to feel laggy, so the box
 * still feels instant. Trailing, not leading, because only the settled query matters — the
 * intermediate prefixes are noise (and the shortest ones are the slowest on this API).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
