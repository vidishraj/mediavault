/**
 * Single-asset edit with an explicit 409 (version_conflict) strategy.
 *
 * THE 409 DECISION — refetch-and-reconcile, never silently discard.
 * PATCH needs the current version and 409s if the row changed underneath the
 * user. There is more than one defensible answer; I chose REFETCH-AND-PROMPT:
 *   - last-write-wins-with-warning silently clobbers whatever the other person
 *     just did — the one outcome the brief forbids ("do not silently discard");
 *   - auto-merge can produce a row neither person chose (my status + their name)
 *     and hides that a conflict happened;
 *   - refetch-and-prompt is the only option that never loses a change without a
 *     human deciding: on 409 we roll back the optimistic write, refetch the
 *     authoritative asset, and expose `conflict` so the panel shows "changed
 *     underneath you" with the current server value. The user then re-applies
 *     their edit against the fresh version (keep-mine) or takes the server's.
 * The cost is one extra interaction on a rare path; the benefit is no lost work.
 * version_conflict is NOT in the retry set, so RQ never auto-retries it — a blind
 * retry would just 409 again against the same stale version.
 *
 * Optimistic + rollback: the edit is applied to the `['asset', id]` cache and (for
 * a status change) the `['assets']` lists, snapshotting prior state by id, and
 * rolled back on any error.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { updateAsset } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { Asset, AssetStatus } from '@/lib/types';
import { type AssetsCache, rollbackFailures, setStatus, snapshotStatuses } from '@/features/bulk/cache';
import { ASSETS_QUERY_KEY } from '@/features/bulk/useBulkStatus';
import { assetKey } from './useAsset';

export type AssetPatch = Partial<Pick<Asset, 'name' | 'status' | 'tags'>>;

export interface UpdateVars {
  version: number;
  patch: AssetPatch;
}

interface UpdateContext {
  prevAsset?: Asset;
  listSnapshot: Map<string, AssetStatus>;
  id: Set<string>;
}

export function useUpdateAsset(id: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation<Asset, unknown, UpdateVars, UpdateContext>({
    mutationFn: ({ version, patch }) => updateAsset(id, version, patch),
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey: assetKey(id) });
      const idSet = new Set([id]);
      const prevAsset = queryClient.getQueryData<Asset>(assetKey(id));

      // optimistic single-asset write
      if (prevAsset) {
        queryClient.setQueryData<Asset>(assetKey(id), { ...prevAsset, ...patch });
      }

      // optimistic list status patch (+ snapshot for rollback)
      const listSnapshot = new Map<string, AssetStatus>();
      if (patch.status) {
        for (const [, data] of queryClient.getQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY })) {
          if (!data) continue;
          for (const [key, prior] of snapshotStatuses(data, idSet)) {
            if (!listSnapshot.has(key)) listSnapshot.set(key, prior);
          }
        }
        queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
          data ? setStatus(data, idSet, patch.status as AssetStatus) : data,
        );
      }
      return { prevAsset, listSnapshot, id: idSet };
    },
    onError: (error, _vars, context) => {
      if (context?.prevAsset) queryClient.setQueryData<Asset>(assetKey(id), context.prevAsset);
      if (context?.listSnapshot.size) {
        queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
          data ? rollbackFailures(data, context.listSnapshot, context.id) : data,
        );
      }
      // On a version conflict, pull the authoritative row so the panel can show
      // the current server value alongside the user's rejected edit.
      if (error instanceof ApiError && error.code === 'version_conflict') {
        void queryClient.invalidateQueries({ queryKey: assetKey(id) });
      }
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Asset>(assetKey(id), updated);
      queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
        data ? setStatus(data, new Set([updated.id]), updated.status) : data,
      );
    },
  });

  const conflict = mutation.error instanceof ApiError && mutation.error.code === 'version_conflict';

  return { ...mutation, conflict };
}
