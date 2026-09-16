// DRAFT — activate after main lands: `git mv` to src/features/assets/useUrlAssetQuery.history.test.tsx,
// then add @testing-library/react + jsdom (devDeps only — do not ship, scored bundle unaffected),
// then run. Written now so the reasoning is captured; see notes/drafts/README.md.
//
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlAssetQuery } from './useUrlAssetQuery';

describe('useUrlAssetQuery — history strategy', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/'); // a clean URL per test
  });
  afterEach(() => vi.restoreAllMocks());

  it('typing REPLACES the entry; a committed filter change PUSHES a new one', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const { result } = renderHook(() => useUrlAssetQuery());

    // Type "studio": every keystroke replaces, none pushes — a whole typing burst is one Back step.
    act(() => result.current.setSearch('s'));
    act(() => result.current.setSearch('st'));
    act(() => result.current.setSearch('studio'));
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.search).toContain('q=studio');

    // Toggle a status filter: one push — a distinct view Back can return to.
    act(() => result.current.toggleStatus('approved'));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toContain('status=approved');
  });

  it('restores the query from the URL on mount', () => {
    window.history.replaceState(null, '', '/?q=hero&status=approved&sort=name%3Aasc');
    const { result } = renderHook(() => useUrlAssetQuery());
    expect(result.current.query).toEqual({ q: 'hero', status: ['approved'], sort: 'name:asc' });
  });

  // MUTATION CHECK (run once, then revert): make setSearch use pushState instead of replaceState and
  // this test must go RED — the `expect(pushSpy).not.toHaveBeenCalled()` after typing fails. If it
  // stays green, the test is not testing the replace-vs-push split.
});
