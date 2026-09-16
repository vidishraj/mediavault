// DRAFT — activate after main lands: `git mv` to src/features/assets/useDebouncedValue.test.tsx,
// then add @testing-library/react + jsdom (devDeps only — they do not ship, so the scored bundle
// is unaffected), then run. Written now so the reasoning is captured; see notes/drafts/README.md.
//
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst of keystrokes into ONE settled value', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), {
      initialProps: { v: 's' },
    });
    expect(result.current).toBe('s'); // the initial value is available immediately

    // Type the rest of "studio", each keystroke 70ms after the last — inside the 250ms window, so
    // the pending timer keeps being cleared and reset and never fires mid-burst.
    for (const v of ['st', 'stu', 'stud', 'studi', 'studio']) {
      rerender({ v });
      act(() => {
        vi.advanceTimersByTime(70);
      });
    }
    // Nothing has settled: the debounced value is still the pre-burst value.
    expect(result.current).toBe('s');

    // The pause: the debounce fires once, with the final value only.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe('studio');
  });

  // MUTATION CHECK (run once to prove the test is non-vacuous, then revert): change the delay to 0
  // in useDebouncedValue and this test must go RED — with no debounce the mid-burst
  // `expect(result.current).toBe('s')` fails because each keystroke settles immediately. If it
  // stays green, the test is not testing the debounce.
});
