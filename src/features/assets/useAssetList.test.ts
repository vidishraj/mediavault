import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { AssetPage } from '@/lib/types';
import { assetListQueryKey } from './useAssetList';

describe('assetListQueryKey', () => {
  it('excludes the cursor, so pagination is not part of the identity', () => {
    const base = { q: 'studio', sort: 'name:asc' as const, limit: 24 };
    const withCursor = { ...base, cursor: 'eyJvIjoyNH0=' };
    expect(assetListQueryKey(withCursor)).toEqual(assetListQueryKey(base));
  });

  it('normalises array order, so reordered filters are the same result set', () => {
    const a = assetListQueryKey({ status: ['approved', 'draft'], kind: ['video', 'image'] });
    const b = assetListQueryKey({ status: ['draft', 'approved'], kind: ['image', 'video'] });
    expect(a).toEqual(b);
  });

  it('distinguishes queries that really differ', () => {
    expect(assetListQueryKey({ q: 'studio' })).not.toEqual(assetListQueryKey({ q: 'studi' }));
    expect(assetListQueryKey({ status: ['draft'] })).not.toEqual(
      assetListQueryKey({ status: ['approved'] }),
    );
  });
});

/**
 * The race, at the layer where the fix lives. An InfiniteQueryObserver is exactly what
 * useInfiniteQuery drives under the hood. We start a SLOW query ("st"), switch the key to a FAST
 * one ("studio") while the first is still in flight, and assert two things the baseline got wrong:
 * the superseded request is aborted, and the data the observer settles on is the NEW query's, never
 * the stale one that resolves later.
 */
describe('stale-response race', () => {
  function page(id: string): AssetPage {
    return { items: [{ id } as never], total: 1, nextCursor: null };
  }

  it('keeps the newest query and aborts the superseded one', async () => {
    const aborted: string[] = [];
    const delayByQ: Record<string, number> = { st: 200, studio: 20 };

    const queryFn = ({ queryKey, signal }: { queryKey: unknown; signal: AbortSignal }) => {
      const q = (queryKey as [string, { q: string }])[1].q;
      return new Promise<AssetPage>((resolve, reject) => {
        const timer = setTimeout(() => resolve(page(q)), delayByQ[q] ?? 50);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          aborted.push(q);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    };

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const common = {
      queryFn,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: AssetPage) => last.nextCursor ?? undefined,
    };

    const observer = new InfiniteQueryObserver(client, {
      queryKey: assetListQueryKey({ q: 'st' }),
      ...common,
    });
    const unsubscribe = observer.subscribe(() => {});

    // The user finishes typing before "st" comes back: switch the key while it is in flight.
    observer.setOptions({ queryKey: assetListQueryKey({ q: 'studio' }), ...common });

    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    // Let the slow "st" timer elapse too, to prove a late arrival changes nothing.
    await new Promise((r) => setTimeout(r, 260));

    const result = observer.getCurrentResult();
    expect(result.data?.pages[0]?.items[0]?.id).toBe('studio'); // the finished query won
    expect(aborted).toContain('st'); // the superseded request was cancelled, not just ignored

    unsubscribe();
    client.clear();
  });
});
