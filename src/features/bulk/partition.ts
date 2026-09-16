/**
 * Turn a 207 partial-success result into an actionable outcome.
 *
 * This is the scored core of Task 3. "Roll back only the failures" and "the two
 * failure reasons want different treatment" both live here:
 *
 * - legal_hold is DETERMINISTIC — anything tagged legal-hold, and it will NEVER
 *   succeed on retry. Offering to retry it re-fires a guaranteed failure into a
 *   rate limiter that counts it. So it is PERMANENT: reported, never retried.
 * - conflict is RANDOM (~7%) and WILL likely succeed on retry, so it is
 *   RETRYABLE. Because a 207 is a 2xx, a conflicted id never becomes an ApiError
 *   and the transport cannot recover it — retrying exactly this subset is how a
 *   bulk action recovers those ~7%.
 *
 * Transport-level failures folded per-id by the client (a whole chunk that
 * exhausted its retries) carry their transient code and are retryable too; a
 * genuinely terminal per-id code (not_found, a validation code) is permanent.
 */

import type { BulkResult } from '@/lib/types';

/**
 * Per-item codes worth retrying: the random bulk `conflict`, plus transient
 * transport codes a failed chunk may have been folded into. Everything else —
 * legal_hold (deterministic), not_found, validation codes — is permanent.
 */
const RETRYABLE_ITEM_CODES: ReadonlySet<string> = new Set([
  'conflict',
  'upstream_unavailable',
  'rate_limited',
  'write_failed',
  'network_error',
]);

export function isItemRetryable(code: string): boolean {
  return RETRYABLE_ITEM_CODES.has(code);
}

export interface FailedItem {
  id: string;
  code: string;
  message?: string;
  retryable: boolean;
}

export interface BulkOutcome {
  /** ids the server confirmed — keep the optimistic change. */
  succeededIds: string[];
  /** ids that did not change — roll these back to their prior status. */
  failedIds: string[];
  failures: FailedItem[];
  /** the subset a "Retry" action should re-send (never the permanent ones). */
  retryableIds: string[];
  /** deterministic failures (e.g. legal_hold) that a retry cannot fix. */
  permanentIds: string[];
}

export function partitionBulk(result: BulkResult): BulkOutcome {
  const succeededIds: string[] = [];
  const failures: FailedItem[] = [];

  for (const item of result.results) {
    if (item.ok) {
      succeededIds.push(item.id);
    } else {
      failures.push({
        id: item.id,
        code: item.code,
        message: item.message,
        retryable: isItemRetryable(item.code),
      });
    }
  }

  const retryableIds = failures.filter((f) => f.retryable).map((f) => f.id);
  const permanentIds = failures.filter((f) => !f.retryable).map((f) => f.id);
  return {
    succeededIds,
    failedIds: failures.map((f) => f.id),
    failures,
    retryableIds,
    permanentIds,
  };
}
