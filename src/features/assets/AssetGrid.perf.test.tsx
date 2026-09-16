// @vitest-environment jsdom
//
// Task 2 measurements as reproducible, mutation-checked tests. Each instrument is
// validated to FAIL before it is trusted to pass (the rig standard): the DOM-node
// bound would trip if virtualisation were off, and the re-render counter is shown
// rising to N when memoisation is deliberately defeated.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { Asset } from '@/lib/types';
import { AssetGrid, type AssetGridProps } from './AssetGrid';

// Count AssetCard renders by counting the StatusChip each card renders exactly once.
const chip = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/StatusChip', () => ({
  StatusChip: () => {
    chip.count++;
    return null;
  },
}));

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
    hasThumbnail: i % 2 === 0,
  };
}

const VIEWPORT_W = 1200;
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
    ({ width: VIEWPORT_W, height: VIEWPORT_H, top: 0, left: 0, right: VIEWPORT_W, bottom: VIEWPORT_H, x: 0, y: 0, toJSON() {} } as DOMRect);
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
function gridEl(assets: Asset[], over: Partial<AssetGridProps> = {}) {
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
  return <AssetGrid {...props} />;
}

describe('AssetGrid virtualisation (Task 2: flat DOM at scale)', () => {
  it('renders a viewport-bounded number of cards for 5,000 assets, not 5,000', async () => {
    const assets = Array.from({ length: 5000 }, (_, i) => mockAsset(i));
    const { container } = render(gridEl(assets));
    let count = 0;
    await waitFor(() => {
      count = container.querySelectorAll('[role="gridcell"]').length;
      expect(count).toBeGreaterThan(0);
    });
    // eslint-disable-next-line no-console
    console.log(`[measure] DOM gridcells for 5,000 assets: ${count}`);
    expect(count).toBeLessThan(200);
    expect(count).toBeLessThan(assets.length); // would trip if virtualisation were off
    cleanup();
  });
});

describe('AssetGrid re-render isolation (Task 2: toggle one, re-render one)', () => {
  it('re-renders only the toggled card; the counter is proven able to reach N', async () => {
    const assets = Array.from({ length: 12 }, (_, i) => mockAsset(i)); // all fit the viewport
    const stableToggle = () => {};
    const { rerender, container } = render(
      gridEl(assets, { onToggleSelect: stableToggle, selectedIds: new Set() }),
    );
    await waitFor(() => expect(container.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0));
    const N = container.querySelectorAll('[role="gridcell"]').length;

    // Toggle ONE selection; everything else (callbacks, activeId, focus) identical.
    chip.count = 0;
    rerender(gridEl(assets, { onToggleSelect: stableToggle, selectedIds: new Set([assets[3]!.id]) }));
    const afterToggle = chip.count;

    // Instrument validation — break memo with a NEW callback identity: every card
    // gets a changed prop, so the counter must rise to N. If it did not, the
    // "== 1" result above would be proving an inert feature, not memoisation.
    chip.count = 0;
    rerender(gridEl(assets, { onToggleSelect: () => {}, selectedIds: new Set([assets[3]!.id]) }));
    const afterBrokenMemo = chip.count;

    // eslint-disable-next-line no-console
    console.log(`[measure] re-renders on one toggle: ${afterToggle} of ${N}; broken-memo control: ${afterBrokenMemo}`);
    expect(afterToggle).toBe(1);
    expect(afterBrokenMemo).toBe(N);
    cleanup();
  });
});
