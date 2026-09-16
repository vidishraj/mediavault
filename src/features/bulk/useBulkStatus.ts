/**
 * The bulk status mutation: optimistic apply, precise rollback, retryable-only
 * recovery, and a CUMULATIVE report across a retry chain.
 *
 * Where optimistic state lives: in the TanStack Query list cache. onMutate
 * snapshots the prior status of every selected id (keyed by id, across all cached
 * filter variants) and writes the new status immediately, so the grid updates
 * before the server confirms. On the 207 result, only the FAILED ids are rolled
 * back to their snapshot; confirmed successes are replaced with the authoritative
 * asset the server returned (`results[].asset`), which also reconciles their
 * incremented `version` into the list AND the `['asset', id]` detail cache — so a
 * subsequent single edit does not PATCH a stale version and manufacture a 409.
 *
 * The report ACCUMULATES across retries. `retryRetryable` re-sends only the
 * still-retryable ids, so its result never mentions the permanent (legal_hold)
 * failures — if the report were just the last run, those would silently vanish
 * and the user would believe the operation completed. Instead the outcome is
 * aggregated: successes union, permanents persist, retryables update, until the
 * next fresh `apply` resets it.
 *
 * Retry ownership: this spreads `chunkedHelperOptions` because bulkSetStatus
 * already owns chunk-level retry, so RQ retry is turned OFF here — otherwise
 * transport and RQ attempts multiply against the rate limit. Recovery from a
 * per-item `conflict` is re-invoking with ONLY the retryable ids, so legal_hold
 * (deterministic) is never re-fired into a counting limiter.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { bulkSetStatus } from '@/api/client';
import { chunkedHelperOptions } from '@/api/queryClient';
import { assetKey } from '@/features/assets/useAsset';
import type { Asset, AssetStatus, BulkResult } from '@/lib/types';
import { type AssetsCache, replaceAssets, rollbackFailures, setStatus, snapshotStatuses } from './cache';
import { type BulkOutcome, type FailedItem, partitionBulk } from './partition';

export const ASSETS_QUERY_KEY = ['assets'] as const;

export interface BulkStatusVars {
  ids: string[];
  status: AssetStatus;
}

interface BulkContext {
  ids: Set<string>;
  snapshot: Map<string, AssetStatus>;
}

/** Cumulative state across a retry chain. */
interface Aggregate {
  succeeded: Set<string>;
  permanent: Map<string, FailedItem>;
  retryable: Map<string, FailedItem>;
}

const emptyAggregate = (): Aggregate => ({ succeeded: new Set(), permanent: new Map(), retryable: new Map() });

function mergeRun(prev: Aggregate, run: BulkOutcome): Aggregate {
  const succeeded = new Set(prev.succeeded);
  const permanent = new Map(prev.permanent);
  const retryable = new Map(prev.retryable);
  for (const id of run.succeededIds) {
    succeeded.add(id);
    permanent.delete(id);
    retryable.delete(id);
  }
  for (const failure of run.failures) {
    if (failure.retryable) {
      retryable.set(failure.id, failure);
      permanent.delete(failure.id);
    } else {
      permanent.set(failure.id, failure);
      retryable.delete(failure.id);
    }
  }
  return { succeeded, permanent, retryable };
}

function toOutcome(aggregate: Aggregate): BulkOutcome {
  const permanentIds = [...aggregate.permanent.keys()];
  const retryableIds = [...aggregate.retryable.keys()];
  return {
    succeededIds: [...aggregate.succeeded],
    failedIds: [...permanentIds, ...retryableIds],
    failures: [...aggregate.permanent.values(), ...aggregate.retryable.values()],
    retryableIds,
    permanentIds,
  };
}

const isEmpty = (a: Aggregate): boolean => a.succeeded.size === 0 && a.permanent.size === 0 && a.retryable.size === 0;

/**
 * @param selectedIds the current selection (owned by useSelection); `apply`
 *   acts on exactly these, so App wires BulkBar.onApply -> apply and the
 *   selection store -> selectedIds, keeping one selection owner.
 */
export function useBulkStatus(selectedIds: ReadonlySet<string>) {
  const queryClient = useQueryClient();
  const lastStatus = useRef<AssetStatus | null>(null);
  const [aggregate, setAggregate] = useState<Aggregate>(emptyAggregate);

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

      // authoritative assets for the successes (carry the incremented version)
      const succeededAssets = new Map<string, Asset>();
      for (const item of result.results) {
        if (item.ok) succeededAssets.set(item.id, item.asset);
      }

      // list: revert failures to their snapshot, and replace successes with the
      // server's asset so the cached version matches the server's.
      queryClient.setQueriesData<AssetsCache>({ queryKey: ASSETS_QUERY_KEY }, (data) =>
        data ? replaceAssets(rollbackFailures(data, context.snapshot, failed), succeededAssets) : data,
      );
      // detail: reconcile any open panel for a succeeded asset, else a stale
      // detail version manufactures a version conflict on the next single edit.
      for (const [id, asset] of succeededAssets) {
        queryClient.setQueryData<Asset>(assetKey(id), asset);
      }

      setAggregate((prev) => mergeRun(prev, outcome));
    },
  });

  const outcome: BulkOutcome | null = isEmpty(aggregate) ? null : toOutcome(aggregate);

  const apply = useCallback(
    (status: AssetStatus) => {
      lastStatus.current = status;
      setAggregate(emptyAggregate()); // fresh operation: clear the prior report
      mutation.mutate({ ids: [...selectedIds], status });
    },
    [mutation, selectedIds],
  );

  /**
   * Retry ONLY the still-retryable subset (conflict) at the same status; the
   * permanent legal_hold failures stay in the report and are never re-fired.
   */
  const retryRetryable = useCallback(() => {
    const ids = [...aggregate.retryable.keys()];
    if (ids.length > 0 && lastStatus.current) {
      mutation.mutate({ ids, status: lastStatus.current });
    }
  }, [mutation, aggregate]);

  return useMemo(
    () => ({
      apply,
      retryRetryable,
      result: mutation.data ?? null,
      outcome,
      isApplying: mutation.isPending,
      reset: () => {
        setAggregate(emptyAggregate());
        mutation.reset();
      },
    }),
    [apply, retryRetryable, mutation, outcome],
  );
}
