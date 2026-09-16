// @vitest-environment jsdom
//
// Task 5 focus management for the non-modal detail panel. The load-bearing test is
// the ESCAPE-FROM-OUTSIDE control: with the old panel-scoped keydown handler an
// Escape pressed once focus had left the panel never reached it, so the panel
// stayed open (the reported defect). Dispatching Escape from a sibling element and
// asserting onClose fires is an instrument that FAILS against the panel-scoped
// handler and PASSES against the document-scoped one — a real control, not a test
// that only proves Tab-wrapping while the escape route stays broken.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Asset } from '@/lib/types';

const h = vi.hoisted(() => ({
  asset: {
    id: 'a_07116',
    name: 'Night Bus Reframe MV-08408',
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
    hasThumbnail: true,
  } as Asset,
}));

vi.mock('./useAsset', () => ({
  assetKey: (id: string) => ['asset', id],
  useAsset: () => ({ data: h.asset, isLoading: false, isError: false, error: null }),
}));
vi.mock('./useUpdateAsset', () => ({
  useUpdateAsset: () => ({
    mutate: () => {},
    reset: () => {},
    conflict: false,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

import { AssetDetail } from './AssetDetail';

afterEach(cleanup);

describe('AssetDetail — non-modal focus management (Task 5)', () => {
  it('closes on Escape even when focus has LEFT the panel (document-scoped, not panel-scoped)', () => {
    const onClose = vi.fn();
    render(
      <div>
        <input data-testid="outside" />
        <AssetDetail id="a_07116" onClose={onClose} />
      </div>,
    );
    const outside = document.querySelector('[data-testid="outside"]') as HTMLInputElement;
    outside.focus();
    // Precondition: focus is OUTSIDE the panel — exactly the state the bug stranded.
    expect(document.activeElement).toBe(outside);

    // Escape dispatched from the sibling input. A handler bound to the <aside> is
    // not on this event's bubble path, so it would never fire; the document
    // listener does. This is the assertion that fails before the fix.
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still closes on Escape when focus is inside the panel (documented case, not regressed)', () => {
    const onClose = vi.fn();
    render(<AssetDetail id="a_07116" onClose={onClose} />);
    const close = document.querySelector('.panel button') as HTMLButtonElement;
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the panel (to Close) when it opens', () => {
    render(<AssetDetail id="a_07116" onClose={() => {}} />);
    const close = document.querySelector('.panel button') as HTMLButtonElement;
    expect(close.textContent).toBe('Close');
    expect(document.activeElement).toBe(close);
  });

  it('restores focus to the element that opened it, on close (not regressed)', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<AssetDetail id="a_07116" onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener); // moved into the panel

    unmount();
    expect(document.activeElement).toBe(opener); // and back to the opener
    opener.remove();
  });

  it('announces a labelled region, NOT a modal dialog (no focus trap implied)', () => {
    const { container } = render(<AssetDetail id="a_07116" onClose={() => {}} />);
    const panel = container.querySelector('.panel')!;
    expect(panel.getAttribute('role')).toBe('region');
    expect(panel.getAttribute('role')).not.toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.getAttribute('aria-labelledby')).toBe('asset-detail-heading');
  });
});
