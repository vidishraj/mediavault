/**
 * User-facing copy for every failure the API can produce.
 *
 * The API says "branch on code, not on message", and its own messages are
 * developer strings ("429: Too many requests in the last 10 seconds."). This is
 * the one place that turns a code into something a person should read: a short
 * title, an optional line saying what happens next, a tone, and whether the
 * action is worth retrying. Components render these, never the raw code.
 *
 * Coordinated with the error taxonomy from the data layer; keyed on the API
 * error `code`, with HTTP status and the offline case as fallbacks.
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
  // The transport reports an unreachable server as network_error (status 0);
  // to the user that is indistinguishable from being offline.
  network_error: {
    title: 'Cannot reach MediaVault',
    body: 'Check your connection. We will retry automatically.',
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
  // A cursor the server no longer accepts (its query changed under it).
  bad_cursor: {
    title: 'That view is out of date',
    body: 'We reloaded it so you are seeing current results.',
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
  // A missing thumbnail: the ASSET still exists, only its preview is absent. In
  // practice thumbnails are a plain <img>, so a 404 fires img.onerror rather than
  // an ApiError and rarely routes here - but mapping it stops the HTTP-404
  // fallback from wrongly claiming the asset itself is gone.
  thumbnail_missing: {
    title: 'Preview unavailable',
    body: 'The thumbnail could not load. The asset itself is unaffected.',
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

/** Title of the generic fallback message. Exported so tests can assert that a
 *  specific code did NOT collapse to it. */
export const GENERIC_ERROR_TITLE = 'Something went wrong';

const UNKNOWN: UserMessage = {
  title: GENERIC_ERROR_TITLE,
  body: 'Please try again.',
  tone: 'danger',
  retryable: true,
};

/** Every code that has a specific message (drives the collapse-catching test). */
export const KNOWN_ERROR_CODES: string[] = Object.keys(MESSAGES);

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

/**
 * The structure the data layer's ApiError exposes (src/api/errors.ts). Kept as a
 * minimal structural type so this copy module has no import dependency on the
 * transport; ApiError satisfies it.
 */
export interface ApiErrorLike {
  code?: string | null;
  status?: number;
}

/**
 * Rich mapping from a typed transport error to a full UserMessage (title, body,
 * tone, retryable). Branches on the structured `code` (falling back to HTTP
 * status), never on message text. Returns null for a user-cancelled request
 * ('aborted'), which must stay silent. Used by the shell's own components that
 * need tone or a retry affordance.
 */
export function userMessageForApiError(err: ApiErrorLike): UserMessage | null {
  if (err.code === 'aborted') return null;
  return messageForError(err.code ?? undefined, err.status);
}

/**
 * The public copy API other layers import: a concise human string for a typed
 * error, or null for an aborted (silent) request. This is the single copy seam
 * for callers that just need words (e.g. an inline "couldn't load more" line).
 * Callers needing tone or a retry affordance use userMessageForApiError.
 */
export function messageForApiError(err: ApiErrorLike): string | null {
  const message = userMessageForApiError(err);
  return message ? message.title : null;
}

/** Structural guard: an object carrying a `code` (the ApiError shape). */
function isApiErrorLike(err: unknown): err is ApiErrorLike {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/**
 * The safe public entry for a caught `unknown` error (the query layer hands
 * callers `error: unknown`). It narrows STRUCTURALLY rather than by cast, so the
 * obvious-but-wrong `messageForApiError(err as ApiErrorLike)` is not the seam any
 * crew reaches for: a non-ApiError (e.g. a plain Error) does not quietly collapse
 * to the generic message unnoticed. In dev it warns at the boundary so the
 * collapse is LOUD rather than silent. Returns null for an aborted (silent)
 * request; a generic string for an unrecognised shape.
 */
export function describeError(err: unknown): string | null {
  if (isApiErrorLike(err)) return messageForApiError(err);
  // Warn everywhere except a production build, so the collapse is loud in dev,
  // in tests, and on the live preview - but never noisy for real users.
  if (import.meta.env?.MODE !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[messages] a non-ApiError reached the copy layer; showing a generic message:',
      err,
    );
  }
  return GENERIC_ERROR_TITLE;
}

/**
 * Fallback for a failure we cannot yet classify. It deliberately does NOT read
 * the error's message text (Task 4 forbids branching on message strings): it
 * only distinguishes offline (a real browser signal) from a generic failure.
 * Once the data layer surfaces a structured `code`, call
 * messageForError(code, httpStatus) directly for a specific message instead.
 */
export function genericFailure(): UserMessage {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return messageForError('offline');
  }
  return messageForError();
}

/** Human summary of a bulk result, e.g. "12 updated. 2 could not be changed." */
export function summarizeBulk(applied: number, failed: number): string {
  const updated = `${applied} ${applied === 1 ? 'asset' : 'assets'} updated`;
  if (failed === 0) return `${updated}.`;
  return `${updated}. ${failed} could not be changed.`;
}

/** Short reason phrases for the per-item bulk failure codes. */
const BULK_REASON: Record<string, string> = {
  legal_hold: 'on legal hold',
  conflict: 'a momentary clash',
  not_found: 'no longer exist',
  version_conflict: 'changed since you loaded them',
  write_failed: 'failed to save',
  invalid_status: 'an invalid status change',
};

/**
 * Group the failed items of a 207 partial result by reason, e.g.
 * "2 on legal hold, 1 a momentary clash." Keeps the partial-failure state
 * specific rather than a bare "2 failed".
 */
export function bulkFailureReasons(results: Array<{ ok?: boolean; code?: string }>): string {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.ok) continue;
    const code = r.code ?? 'unknown';
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(
    ([code, n]) => `${n} ${BULK_REASON[code] ?? 'could not be changed'}`,
  );
  return parts.length ? `${parts.join(', ')}.` : '';
}
