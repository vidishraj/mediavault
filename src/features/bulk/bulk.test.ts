import type { InfiniteData } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { Asset, AssetPage, AssetStatus, BulkResult } from '@/lib/types';
import { rollbackFailures, setStatus, snapshotStatuses } from './cache';
import { isItemRetryable, partitionBulk } from './partition';

function asset(id: string, status: AssetStatus): Asset {
  return {
    id,
    name: id,
    kind: 'image',
    status,
    tags: [],
    collectionId: 'c_01',
    owner: { id: 'u_01', name: 'U' },
    sizeBytes: 1,
    width: 1,
    height: 1,
    durationSec: null,
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2020-01-01T00:00:00Z',
    version: 1,
    hasThumbnail: true,
  };
}

/** Two pages so we prove the transforms cross page boundaries. */
function cache(...statuses: Array<[string, AssetStatus]>): InfiniteData<AssetPage> {
  const items = statuses.map(([id, s]) => asset(id, s));
  const mid = Math.ceil(items.length / 2);
  const page = (its: Asset[]): AssetPage => ({ items: its, total: items.length, nextCursor: null });
  return { pages: [page(items.slice(0, mid)), page(items.slice(mid))], pageParams: [undefined, 'c1'] };
}

const statusOf = (data: InfiniteData<AssetPage>, id: string): AssetStatus | undefined =>
  data.pages.flatMap((p) => p.items).find((a) => a.id === id)?.status;

describe('partitionBulk', () => {
  const result: BulkResult = {
    applied: 1,
    failed: 2,
    results: [
      { id: 'a', ok: true, asset: asset('a', 'approved') },
      { id: 'b', ok: false, code: 'legal_hold', message: 'on hold' },
      { id: 'c', ok: false, code: 'conflict' },
    ],
  };

  it('splits successes from failures', () => {
    const out = partitionBulk(result);
    expect(out.succeededIds).toEqual(['a']);
    expect(out.failedIds.sort()).toEqual(['b', 'c']);
  });

  it('treats legal_hold as PERMANENT and conflict as RETRYABLE (the trap)', () => {
    const out = partitionBulk(result);
    expect(out.retryableIds).toEqual(['c']); // conflict only
    expect(out.permanentIds).toEqual(['b']); // legal_hold never retried
    expect(isItemRetryable('legal_hold')).toBe(false);
    expect(isItemRetryable('conflict')).toBe(true);
  });

  it('treats a transport code folded per-id as retryable', () => {
    const out = partitionBulk({
      applied: 0,
      failed: 1,
      results: [{ id: 'x', ok: false, code: 'upstream_unavailable' }],
    });
    expect(out.retryableIds).toEqual(['x']);
  });
});

describe('optimistic apply then roll back ONLY the failures', () => {
  it('keeps confirmed successes and reverts only failed ids', () => {
    const before = cache(['a', 'draft'], ['b', 'draft'], ['c', 'draft']);
    const ids = new Set(['a', 'b', 'c']);

    // snapshot BEFORE the optimistic write — this is how rollback finds prior state
    const snapshot = snapshotStatuses(before, ids);
    const optimistic = setStatus(before, ids, 'approved');
    expect([statusOf(optimistic, 'a'), statusOf(optimistic, 'b'), statusOf(optimistic, 'c')]).toEqual([
      'approved',
      'approved',
      'approved',
    ]);

    // server: a succeeded, b legal_hold, c conflict -> failures {b, c}
    const out = partitionBulk({
      applied: 1,
      failed: 2,
      results: [
        { id: 'a', ok: true, asset: asset('a', 'approved') },
        { id: 'b', ok: false, code: 'legal_hold' },
        { id: 'c', ok: false, code: 'conflict' },
      ],
    });

    const rolledBack = rollbackFailures(optimistic, snapshot, new Set(out.failedIds));
    // the SUCCESS keeps the new status; the FAILURES revert to draft
    expect(statusOf(rolledBack, 'a')).toBe('approved');
    expect(statusOf(rolledBack, 'b')).toBe('draft');
    expect(statusOf(rolledBack, 'c')).toBe('draft');
  });

  it('does not touch assets outside the operation', () => {
    const before = cache(['a', 'draft'], ['other', 'archived']);
    const optimistic = setStatus(before, new Set(['a']), 'approved');
    expect(statusOf(optimistic, 'other')).toBe('archived'); // untouched
  });
});
