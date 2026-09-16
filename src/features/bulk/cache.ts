/**
 * Pure cache transforms for optimistic bulk updates and precise rollback.
 *
 * These operate on the list cache shape (`InfiniteData<AssetPage>`) as plain
 * data, with no TanStack Query or React involved, so the scored logic — "apply
 * optimistically, then roll back ONLY the failures, keep the successes" — is
 * unit-testable and mutation-testable on its own. The hook (useBulkStatus) is
 * thin glue that snapshots before mutating and calls `rollbackFailures` with the
 * failed subset from `partitionBulk`.
 *
 * How rollback finds the right rows: the snapshot is a Map keyed by asset id,
 * captured BEFORE the optimistic write; rollback restores an id's prior status
 * only if that id is in the failed set. Successes are never touched, so a
 * confirmed change survives even though its neighbour rolled back.
 */

import type { InfiniteData } from '@tanstack/react-query';
import type { Asset, AssetPage, AssetStatus } from '@/lib/types';

export type AssetsCache = InfiniteData<AssetPage>;

function mapItems(data: AssetsCache, fn: (asset: Asset) => Asset): AssetsCache {
  return {
    ...data,
    pages: data.pages.map((page) => ({ ...page, items: page.items.map(fn) })),
  };
}

/** Optimistically set `status` on the given ids across every cached page. */
export function setStatus(data: AssetsCache, ids: ReadonlySet<string>, status: AssetStatus): AssetsCache {
  return mapItems(data, (asset) => (ids.has(asset.id) ? { ...asset, status } : asset));
}

/** Prior status of each requested id, for rollback. First occurrence wins. */
export function snapshotStatuses(data: AssetsCache, ids: ReadonlySet<string>): Map<string, AssetStatus> {
  const snapshot = new Map<string, AssetStatus>();
  for (const page of data.pages) {
    for (const asset of page.items) {
      if (ids.has(asset.id) && !snapshot.has(asset.id)) snapshot.set(asset.id, asset.status);
    }
  }
  return snapshot;
}

/**
 * Replace whole assets by id with the authoritative versions the server
 * returned (the 207's `results[].asset`). This reconciles the incremented
 * `version` into the cache, so a later single edit does not PATCH a stale
 * version and manufacture a 409.
 */
export function replaceAssets(data: AssetsCache, byId: ReadonlyMap<string, Asset>): AssetsCache {
  return mapItems(data, (asset) => byId.get(asset.id) ?? asset);
}

/** Restore ONLY the failed ids to their snapshotted status; leave successes. */
export function rollbackFailures(
  data: AssetsCache,
  snapshot: ReadonlyMap<string, AssetStatus>,
  failedIds: ReadonlySet<string>,
): AssetsCache {
  return mapItems(data, (asset) =>
    failedIds.has(asset.id) && snapshot.has(asset.id)
      ? { ...asset, status: snapshot.get(asset.id) as AssetStatus }
      : asset,
  );
}
