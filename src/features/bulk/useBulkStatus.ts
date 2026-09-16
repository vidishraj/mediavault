/**
 * The bulk status mutation: optimistic apply, precise rollback, retryable-only
 * recovery.
 *
 * Where optimistic state lives: in the TanStack Query list cache. onMutate
 * snapshots the prior status of every selected id (keyed by id, across all cached
 * filter variants) and writes the new status immediately, so the grid updates
 * before the server confirms. On the 207 result, only the FAILED ids are rolled
 * back to their snapshot; confirmed successes keep the new status.
 *
 * Retry ownership (MAJOR 2): this is a real call site of `chunkedHelperOptions`.
 * bulkSetStatus already owns chunk-level retry (re-request only the failed
 * chunk), so RQ retry is turned OFF here — otherwise attempts would multiply
 * against the rate limit. Recovery from per-item `conflict` is NOT a blind RQ
 * retry; it is re-invoking this mutation with ONLY `outcome.retryableIds`, so
 * legal_hold (deterministic) is never re-fired.
 */

import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { bulkSetStatus } from '@/api/client';
import { chunkedHelperOptions } from '@/api/queryClient';
import type { AssetStatus, BulkResult } from '@/lib/types';
import { type AssetsCache, rollbackFailures, setStatus, snapshotStatuses } from './cache';
import { type BulkOutcome, partitionBulk } from './partition';

export const ASSETS_QUERY_KEY = ['assets'] as const;

export interface BulkStatusVars {
  ids: string[];
  status: AssetStatus;
}

interface BulkContext {
  ids: Set<string>;
  snapshot: Map<string, AssetStatus>;
}

/**
 * @param selectedIds the current selection (owned by useSelection); `apply`
 *   acts on exactly these, so App wires BulkBar.onApply -> apply and the
 *   selection store -> selectedIds, keeping one selection owner.
 */
export function useBulkStatus(selectedIds: ReadonlySet<string>) {
  const queryClient = useQueryClient();
  const lastStatus = useRef<AssetStatus | null>(null);

  const mutation = useMutation<BulkResult, unknown, BulkStatusVars, BulkContext>({
    ...chunkedHelperOptions, // retry: false — bulkSetStatus owns its chunk-level retry
    mutationFn: ({ ids, status }) => bulkSetStatus(ids, status),
    onMutate: async ({ ids, status }) => {
      // Stop in-flight list refetches from clobbering the optimistic write.
      await queryClient.cancelQueries({ queryKey: ASSETS_QUERY_KEY });
      const idSet = new Set(ids);
      const snapshot = new Map<string, AssetStatus>();
      for (const [, data] of queryClient.getQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY })) {
        if (!data) continue;
        for (const [id, prior] of snapshotStatuses(data, idSet)) {
          if (!snapshot.has(id)) snapshot.set(id, prior);
        }
      }
      queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
        data ? setStatus(data, idSet, status) : data,
      );
      return { ids: idSet, snapshot };
    },
    onError: (_error, _vars, context) => {
      // A whole-operation failure (bulkSetStatus normally folds transport failures
      // into per-id results, so this is rare): revert every optimistic change.
      if (!context) return;
      queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
        data ? rollbackFailures(data, context.snapshot, context.ids) : data,
      );
    },
    onSuccess: (result, _vars, context) => {
      if (!context) return;
      const outcome = partitionBulk(result);
      const failed = new Set(outcome.failedIds);
      queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
        data ? rollbackFailures(data, context.snapshot, failed) : data,
      );
    },
  });

  /** The partitioned outcome of the last run, for the bar to render. */
  const outcome: BulkOutcome | null = mutation.data ? partitionBulk(mutation.data) : null;

  const apply = useCallback(
    (status: AssetStatus) => {
      lastStatus.current = status;
      mutation.mutate({ ids: [...selectedIds], status });
    },
    [mutation, selectedIds],
  );

  /**
   * Retry ONLY the retryable subset (conflict, ~7% random) at the same status —
   * never the permanent legal_hold failures, which would just re-fire guaranteed
   * failures into the counting rate limiter.
   */
  const retryRetryable = useCallback(() => {
    if (outcome && outcome.retryableIds.length > 0 && lastStatus.current) {
      mutation.mutate({ ids: outcome.retryableIds, status: lastStatus.current });
    }
  }, [mutation, outcome]);

  return {
    apply,
    retryRetryable,
    result: mutation.data ?? null,
    outcome,
    isApplying: mutation.isPending,
    reset: mutation.reset,
  };
}
