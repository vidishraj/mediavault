import { Banner } from './Banner';
import { messageForError, userMessageForApiError, type ApiErrorLike } from '@/lib/messages';

/**
 * The whole-query failure banner (list status === 'error'): copy from the typed
 * error, announced assertively, with a Try again that refetches. A whole-query
 * GET is always safe to retry, so the retry is offered regardless of the code.
 */
export function QueryErrorBanner({ error, onRetry }: { error: ApiErrorLike; onRetry: () => void }) {
  const base = userMessageForApiError(error) ?? messageForError();
  return <Banner message={{ ...base, retryable: true }} onRetry={onRetry} />;
}
