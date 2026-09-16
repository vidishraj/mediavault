/**
 * User-facing copy for every failure the API can produce.
 *
 * The API says "branch on code, not on message", and its own messages are
 * developer strings ("429: Too many requests in the last 10 seconds."). This is
 * the one place that turns a code into something a person should read: a short
 * title, an optional line saying what happens next, a tone, and whether the
 * action is worth retrying. Components render these, never the raw code.
 *
 * Coordinated with the error taxonomy from the data layer (wb-u11); keyed on the
 * API error `code`, with HTTP status and the offline case as fallbacks.
 */

export type MessageTone = 'info' | 'warn' | 'danger';

export interface UserMessage {
  title: string;
  /** What the system is doing or what the user should do next. Optional. */
  body?: string;
  tone: MessageTone;
  /** True when trying again can succeed (drives a Retry affordance / auto-retry). */
  retryable: boolean;
}

const MESSAGES: Record<string, UserMessage> = {
  // Transient service problems: we recover on the user's behalf.
  upstream_unavailable: {
    title: 'MediaVault is briefly unavailable',
    body: 'Retrying automatically.',
    tone: 'warn',
    retryable: true,
  },
  rate_limited: {
    title: 'Slowing down to keep up',
    body: 'Too many requests just now. Pausing a few seconds, then continuing.',
    tone: 'warn',
    retryable: true,
  },
  write_failed: {
    title: 'That did not save',
    body: 'It is safe to try again.',
    tone: 'danger',
    retryable: true,
  },
  conflict: {
    title: 'A momentary clash',
    body: 'Retrying the items that clashed.',
    tone: 'info',
    retryable: true,
  },
  offline: {
    title: 'You are offline',
    body: 'Changes will resume when the connection returns.',
    tone: 'warn',
    retryable: true,
  },

  // The world changed under us: recoverable, but not by blind retry.
  stale_cursor: {
    title: 'The list moved on',
    body: 'We refreshed it so you are seeing current results.',
    tone: 'info',
    retryable: false,
  },
  version_conflict: {
    title: 'This asset changed while you were editing',
    body: 'Someone saved a newer version. Refresh to see it, then reapply your change.',
    tone: 'warn',
    retryable: false,
  },
  not_found: {
    title: 'This asset is no longer available',
    body: 'It may have been removed.',
    tone: 'info',
    retryable: false,
  },

  // The request itself needs changing: retrying as-is will not help.
  too_many_ids: {
    title: 'Too many items for one request',
    body: 'We split the selection into smaller batches.',
    tone: 'info',
    retryable: false,
  },
  invalid_name: {
    title: 'Name is too short',
    body: 'Give it at least 3 characters.',
    tone: 'warn',
    retryable: false,
  },
  invalid_status: {
    title: 'That status is not allowed here',
    tone: 'warn',
    retryable: false,
  },
  invalid_tags: {
    title: 'One or more tags are not valid',
    tone: 'warn',
    retryable: false,
  },
  legal_hold: {
    title: 'This asset is on legal hold',
    body: 'Assets on legal hold cannot be archived.',
    tone: 'warn',
    retryable: false,
  },
  bad_request: {
    title: 'That request could not be completed',
    tone: 'danger',
    retryable: false,
  },
};

const UNKNOWN: UserMessage = {
  title: 'Something went wrong',
  body: 'Please try again.',
  tone: 'danger',
  retryable: true,
};

/**
 * Resolve a user message from an API error code, falling back to the HTTP
 * status (e.g. a bare 429 with no code) and finally to a safe generic message.
 */
export function messageForError(code?: string | null, httpStatus?: number): UserMessage {
  if (code) {
    const byCode = MESSAGES[code];
    if (byCode) return byCode;
  }
  const fallbackKey =
    httpStatus === 429
      ? 'rate_limited'
      : httpStatus === 503
        ? 'upstream_unavailable'
        : httpStatus === 404
          ? 'not_found'
          : null;
  if (fallbackKey) {
    const byStatus = MESSAGES[fallbackKey];
    if (byStatus) return byStatus;
  }
  return UNKNOWN;
}

/** Human summary of a bulk result, e.g. "12 updated. 2 could not be changed." */
export function summarizeBulk(applied: number, failed: number): string {
  const updated = `${applied} ${applied === 1 ? 'asset' : 'assets'} updated`;
  if (failed === 0) return `${updated}.`;
  return `${updated}. ${failed} could not be changed.`;
}
