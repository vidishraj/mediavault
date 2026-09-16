import { STATUS_ORDER, statusMeta } from '@/lib/status';
import { bulkFailureReasons, summarizeBulk } from '@/lib/messages';
import { Banner } from './Banner';
import type { AssetStatus, BulkResult } from '@/lib/types';

interface BulkBarProps {
  selectedCount: number;
  onApply: (status: AssetStatus) => void;
  onClear: () => void;
  /** The last bulk result, if any; persists after selection clears so the
   *  outcome stays visible. Owned by the action hook, not this bar. */
  result: BulkResult | null;
  /** Disables the actions while an apply is in flight. */
  isApplying?: boolean;
}

/**
 * The bulk action bar and its outcome, presentational only. It renders the
 * selected count, one apply button per lifecycle status, and a plain-language
 * outcome (including a per-reason breakdown on partial 207 failure). The action
 * itself (chunking, the API call, optimistic update and rollback) is the bulk
 * hook's job; this bar just calls onApply / onClear.
 */
export function BulkBar({ selectedCount, onApply, onClear, result, isApplying = false }: BulkBarProps) {
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
      {result && (
        <Banner
          message={{
            title: summarizeBulk(result.applied, result.failed),
            body: result.failed > 0 ? bulkFailureReasons(result.results) : undefined,
            tone: result.failed > 0 ? 'warn' : 'info',
            retryable: false,
          }}
        />
      )}
    </>
  );
}
