/**
 * Maps a structured error to copy a human can act on.
 *
 * "429: Too many requests in the last 10 seconds." is a leaked implementation
 * detail, not a message. Because the taxonomy is structured, the mapping is a
 * table keyed on `code` — the UI never parses a server string to decide what to
 * say. Callers (the list, the bulk bar, the detail panel) render these.
 */

import { ApiError, type ErrorCode } from './errors';

const MESSAGES: Record<ErrorCode, string> = {
  bad_request: 'That request could not be completed.',
  stale_cursor: 'The list has moved on. Reloading from the top.',
  bad_cursor: 'The list has moved on. Reloading from the top.',
  too_many_ids: 'That is too many items in one action.',
  not_found: 'That asset no longer exists.',
  thumbnail_missing: 'No preview available.',
  version_conflict: 'This asset changed since you opened it. Refresh to see the latest version.',
  invalid_name: 'Names must be at least 3 characters.',
  invalid_status: 'That status is not allowed here.',
  invalid_tags: 'Those tags are not valid.',
  legal_hold: 'This asset is on legal hold and cannot be changed.',
  rate_limited: 'You are moving a little too fast. Give it a few seconds.',
  write_failed: 'That did not save. Trying again.',
  upstream_unavailable: 'The library is briefly unavailable. Retrying.',
  conflict: 'This asset changed while updating. You can retry it.',
  network_error: "You appear to be offline. We'll pick up where you left off when the connection returns.",
  aborted: 'Cancelled.',
  unknown: 'Something went wrong. Please try again.',
};

export function toUserMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? MESSAGES.unknown;
  return MESSAGES.unknown;
}
