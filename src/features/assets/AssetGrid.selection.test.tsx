// @vitest-environment jsdom
//
// Task 3 + Task 5 range selection, tested through the REAL AssetGrid so the
// onFocusCapture → syncFocus loop is in the path — that loop is what silently
// re-anchored mid-extend and collapsed every range to a single step. The keyboard
// test fires THREE consecutive Shift+Arrows and asserts the range GROWS each time:
// a one-press test passes on the broken code (the first press always worked), which
// is exactly why the defect survived a suite that already covered the keyboard model.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Asset } from '@/lib/types';
import { AssetGrid, type AssetGridProps } from './AssetGrid';

function mockAsset(i: number): Asset {
  return {
    id: `a_${i}`,
    name: `Asset ${i}`,
    kind: 'image',
    status: 'draft',
    tags: [],
    collectionId: 'c_1',
    owner: { id: 'u_1', name: 'Owner' },
    sizeBytes: 1024,
    width: 100,
    height: 100,
    durationSec: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 1,
    hasThumbnail: false,
  };
}

const VIEWPORT_W = 1200; // → floor(1200 / 320) = 3 columns, so ArrowDown moves +3
const VIEWPORT_H = 800;
let restore: Array<() => void> = [];

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      this.cb(
        [
          {
            target: el,
            contentRect: { width: VIEWPORT_W, height: VIEWPORT_H } as DOMRectReadOnly,
            borderBoxSize: [{ blockSize: VIEWPORT_H, inlineSize: VIEWPORT_W }],
            contentBoxSize: [{ blockSize: VIEWPORT_H, inlineSize: VIEWPORT_W }],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  };
  const defprop = (name: string, value: number) => {
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
    restore.push(() => {
      if (orig) Object.defineProperty(HTMLElement.prototype, name, orig);
    });
  };
  defprop('clientWidth', VIEWPORT_W);
  defprop('clientHeight', VIEWPORT_H);
  const origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: VIEWPORT_W, height: VIEWPORT_H, top: 0, left: 0, right: VIEWPORT_W, bottom: VIEWPORT_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  restore.push(() => {
    Element.prototype.getBoundingClientRect = origRect;
  });
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
});

afterAll(() => {
  restore.forEach((f) => f());
  restore = [];
});

const noop = () => {};
function renderGrid(over: Partial<AssetGridProps> = {}) {
  const assets = Array.from({ length: 30 }, (_, i) => mockAsset(i));
  const props: AssetGridProps = {
    assets,
    total: assets.length,
    isFirstPageLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    nextPageError: null,
    onFetchNextPage: noop,
    selectedIds: new Set<string>(),
    activeId: null,
    onToggleSelect: noop,
    onOpen: noop,
    onSelectRange: noop,
    ...over,
  };
  return { assets, ...render(<AssetGrid {...props} />) };
}

describe('AssetGrid range selection (Task 5: Shift+arrows extend across MULTIPLE presses)', () => {
  it('grows the range on each of three consecutive Shift+ArrowDown presses', async () => {
    const onSelectRange = vi.fn();
    const { container } = renderGrid({ onSelectRange });
    await waitFor(() =>
      expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0),
    );
    const grid = container.querySelector('[role="grid"]')!;

    // Anchor at index 0, then extend downward three times (3 columns → +3 per press).
    fireEvent.keyDown(grid, { key: ' ' }); // Space: anchor at focused index 0
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });

    const lengths = onSelectRange.mock.calls.map((c) => (c[0] as string[]).length);
    // eslint-disable-next-line no-console
    console.log(`[measure] Shift+ArrowDown range lengths across presses: ${lengths.join(', ')}`);
    expect(lengths.length).toBe(3);
    // The load-bearing assertion: each press extends from the SAME anchor, so the
    // range strictly grows. On the broken code these were all equal (~4) because
    // syncFocus re-anchored to the landing cell after every press.
    expect(lengths[0]).toBeLessThan(lengths[1]!);
    expect(lengths[1]).toBeLessThan(lengths[2]!);
    // Concretely: [0..3]=4, [0..6]=7, [0..9]=10.
    expect(lengths).toEqual([4, 7, 10]);
    cleanup();
  });
});

describe('AssetGrid pointer selection (Task 3: click selects, shift-click extends)', () => {
  it('plain click selects only the clicked card; shift-click extends the range from it', async () => {
    const onSelectRange = vi.fn();
    const onOpen = vi.fn();
    const { assets, container } = renderGrid({ onSelectRange, onOpen });
    await waitFor(() =>
      expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0),
    );
    const cardOf = (id: string) => container.querySelector(`[data-index-id="${id}"]`)!;

    fireEvent.click(cardOf(assets[0]!.id)); // plain click → select only this one
    expect(onSelectRange).toHaveBeenLastCalledWith([assets[0]!.id]);
    expect(onOpen).not.toHaveBeenCalled(); // click no longer opens

    fireEvent.click(cardOf(assets[6]!.id), { shiftKey: true }); // shift-click → extend 0..6
    const last = onSelectRange.mock.calls.at(-1)![0] as string[];
    expect(last).toHaveLength(7);
    expect(last[0]).toBe(assets[0]!.id);
    expect(last[6]).toBe(assets[6]!.id);
    cleanup();
  });

  it('double-click opens the detail panel', async () => {
    const onOpen = vi.fn();
    const { assets, container } = renderGrid({ onOpen });
    await waitFor(() =>
      expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0),
    );
    fireEvent.doubleClick(container.querySelector(`[data-index-id="${assets[2]!.id}"]`)!);
    expect(onOpen).toHaveBeenCalledWith(assets[2]!.id);
    cleanup();
  });
});
