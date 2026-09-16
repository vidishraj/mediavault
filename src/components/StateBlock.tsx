import type { ReactNode } from 'react';

type StateVariant = 'empty' | 'error' | 'offline';

const DEFAULT_ICON: Record<StateVariant, string> = {
  empty: '⌕', // nothing to show
  error: '!', // something went wrong
  offline: '⦸', // disconnected
};

interface StateBlockProps {
  variant?: StateVariant;
  title: string;
  body?: string;
  /** An action that moves the user forward: retry, clear filters, reconnect. */
  action?: ReactNode;
  icon?: string;
}

/**
 * A full-area state for the grid region. Every state names what happened AND
 * offers the next step, so a blank result never looks like a broken screen.
 */
export function StateBlock({ variant = 'empty', title, body, action, icon }: StateBlockProps) {
  return (
    <div className={`state state--${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <div className="state__icon" aria-hidden="true">
        {icon ?? DEFAULT_ICON[variant]}
      </div>
      <div className="state__title">{title}</div>
      {body ? <p className="state__body">{body}</p> : null}
      {action ? <div className="state__action">{action}</div> : null}
    </div>
  );
}
