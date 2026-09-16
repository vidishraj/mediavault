/**
 * Typed error taxonomy.
 *
 * The API returns `{ "error": { "code", "message" } }` on every failure and the
 * contract is explicit: branch on `code`, never on `message`. The baseline
 * flattened everything to `new Error("503: msg")`, so a caller could only tell a
 * retryable 503 from a fatal 409 by parsing English — which breaks the moment a
 * message is reworded. This module parses each failure into a structured
 * `ApiError` carrying the machine-readable `code`, the HTTP `status`, the
 * `x-request-id` (for log correlation) and any `Retry-After`. The retry decision
 * (see ./retry) is then a pure function of the taxonomy, not of strings.
 */

/** Every `code` the frozen server can emit, plus two client-synthesised ones. */
export type ErrorCode =
  // 400
  | 'bad_request'
  | 'stale_cursor'
  | 'bad_cursor'
  | 'too_many_ids'
  // 404
  | 'not_found'
  | 'thumbnail_missing'
  // 409
  | 'version_conflict'
  // 422
  | 'invalid_name'
  | 'invalid_status'
  | 'invalid_tags'
  | 'legal_hold'
  // 429
  | 'rate_limited'
  // 500
  | 'write_failed'
  // 503
  | 'upstream_unavailable'
  // per-item bulk failure (POST /bulk-status results[])
  | 'conflict'
  // client-synthesised: fetch itself threw (offline, DNS, connection reset)
  | 'network_error'
  // client-synthesised: the request was aborted via its AbortSignal
  | 'aborted'
  // anything the server sends that we do not yet model
  | 'unknown';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
}

export interface ApiErrorInit {
  code: ErrorCode;
  status: number; // HTTP status; 0 for network_error / aborted
  message: string;
  requestId?: string | null;
  retryAfterMs?: number | null;
  cause?: unknown;
}

/**
 * A single structured error type for the whole client. Carries everything a
 * caller needs to decide what to do without reading the message.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly requestId: string | null;
  /** Parsed from the `Retry-After` header (seconds → ms), or null. */
  readonly retryAfterMs: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    // Restore the prototype chain across the ES5 transpile target so
    // `instanceof ApiError` holds.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get isNetwork(): boolean {
    return this.code === 'network_error';
  }

  get isAborted(): boolean {
    return this.code === 'aborted';
  }
}

/** `Retry-After` is in seconds per HTTP; return milliseconds, or null. */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // HTTP also allows an HTTP-date; fall back to that.
  const date = Date.parse(headerValue);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const err = (value as { error?: unknown }).error;
  return typeof err === 'object' && err !== null && typeof (err as { code?: unknown }).code === 'string';
}

/**
 * Build an `ApiError` from a non-OK `Response`. The body is already-parsed JSON
 * (or undefined if it was not JSON) so this stays synchronous and testable.
 */
export function apiErrorFromResponse(response: Response, body: unknown): ApiError {
  const requestId = response.headers.get('x-request-id');
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
  if (isApiErrorBody(body)) {
    return new ApiError({
      code: body.error.code,
      status: response.status,
      message: body.error.message,
      requestId,
      retryAfterMs,
    });
  }
  // Non-JSON or unexpected shape: keep the status, mark the code unknown rather
  // than inventing one.
  return new ApiError({
    code: 'unknown',
    status: response.status,
    message: response.statusText || `Request failed with ${response.status}`,
    requestId,
    retryAfterMs,
  });
}

/** Wrap a thrown `fetch` error (offline, DNS, reset) or an abort. */
export function apiErrorFromThrown(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  const aborted =
    (cause instanceof DOMException && cause.name === 'AbortError') ||
    (cause instanceof Error && cause.name === 'AbortError');
  if (aborted) {
    return new ApiError({ code: 'aborted', status: 0, message: 'Request was cancelled.', cause });
  }
  return new ApiError({
    code: 'network_error',
    status: 0,
    message: 'Network request failed.',
    cause,
  });
}
