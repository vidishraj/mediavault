import { STATUS_ORDER, statusMeta } from '@/lib/status';
import { bulkFailureReasons, summarizeBulk } from '@/lib/messages';
import { Banner } from './Banner';
import type { AssetStatus } from '@/lib/types';

/**
 * The partitioned outcome from the bulk action hook (structural, so this
 * component has no import dependency on the hook file; useBulkStatus's
 * BulkOutcome satisfies it).
 */
export interface BulkOutcomeLike {
  succeededIds: string[];
  failedIds: string[];
  failures: Array<{ id: string; code: string; message?: string; retryable: boolean }>;
  retryableIds: string[];
  permanentIds: string[];
}

interface BulkBarProps {
  selectedCount: number;
  onApply: (status: AssetStatus) => void;
  onClear: () => void;
  /** Partitioned result of the last apply; null until one completes. The action
   *  hook owns clearing it at the start of the next apply. */
  outcome: BulkOutcomeLike | null;
  /** Retry ONLY the retryable subset (hook.retryRetryable). */
  onRetry: () => void;
  /** Disables the actions while an apply/retry is in flight. */
  isApplying?: boolean;
}

/**
 * The bulk action bar and its outcome, presentational only. It renders the
 * selected count, one apply button per lifecycle status, and a plain-language
 * outcome that draws the scored distinction: items that hit a momentary clash
 * can be retried (the hook re-sends only that subset), while items on legal hold
 * cannot be changed and get no retry. The action itself (chunking, the API call,
 * optimistic update and rollback) is the hook's job.
 */
export function BulkBar({
  selectedCount,
  onApply,
  onClear,
  outcome,
  onRetry,
  isApplying = false,
}: BulkBarProps) {
  const failedCount = outcome ? outcome.failedIds.length : 0;
  const canRetry = !!outcome && outcome.retryableIds.length > 0;
  const reasons = outcome && failedCount > 0 ? bulkFailureReasons(outcome.failures) : '';
  const permanentNote =
    outcome && outcome.permanentIds.length > 0 ? ' Items on legal hold cannot be changed.' : '';

  return (
    <>
      {selectedCount > 0 && (
        <div className="bulkbar" role="group" aria-label="Bulk actions">
          <span className="bulkbar__count">{selectedCount} selected</span>
          {STATUS_ORDER.map((s) => (
            <button key={s} onClick={() => onApply(s)} disabled={isApplying}>
              Set {statusMeta(s).label.toLowerCase()}
            </button>
          ))}
          <span className="bulkbar__spacer" />
          <button className="btn-subtle" onClick={onClear} disabled={isApplying}>
            Clear selection
          </button>
        </div>
      )}
      {outcome && (
        <Banner
          message={{
            title: summarizeBulk(outcome.succeededIds.length, failedCount),
            body: reasons ? (reasons + permanentNote).trim() : undefined,
            tone: failedCount > 0 ? 'warn' : 'info',
            retryable: canRetry,
          }}
          onRetry={canRetry ? onRetry : undefined}
        />
      )}
    </>
  );
}
