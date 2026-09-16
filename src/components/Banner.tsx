import type { UserMessage } from '@/lib/messages';

const TONE_ICON: Record<UserMessage['tone'], string> = {
  info: 'ℹ',
  warn: '▲',
  danger: '✕',
};

interface BannerProps {
  message: UserMessage;
  /** Shown only when the message is retryable. */
  onRetry?: () => void;
  onDismiss?: () => void;
}

/**
 * Inline strip for a transient or recoverable condition. Tone is carried by the
 * wording and the icon as well as colour; danger is announced assertively.
 */
export function Banner({ message, onRetry, onDismiss }: BannerProps) {
  return (
    <div
      className={`banner banner--${message.tone}`}
      role={message.tone === 'danger' ? 'alert' : 'status'}
    >
      <span className="banner__icon" aria-hidden="true">
        {TONE_ICON[message.tone]}
      </span>
      <span>
        <span className="banner__title">{message.title}</span>
        {message.body ? <span className="banner__body"> {message.body}</span> : null}
      </span>
      {message.retryable && onRetry ? (
        <button className="banner__action btn-subtle" onClick={onRetry}>
          Try again
        </button>
      ) : null}
      {onDismiss ? (
        <button className="btn-subtle" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
