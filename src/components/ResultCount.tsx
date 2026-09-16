/** Whole-view list status enum from the search hook (structural; the hook's
 *  AssetListStatus satisfies it). */
export type ListStatus = 'loading' | 'empty' | 'error' | 'ready';

interface ResultCountProps {
  loaded: number;
  total: number;
  status: ListStatus;
}

/**
 * The "N of M shown" summary. It is a polite live region so a screen reader
 * hears the settled count; the upstream query is debounced, so this does not
 * chatter per keystroke.
 */
export function ResultCount({ loaded, total, status }: ResultCountProps) {
  const text = status === 'loading' ? 'Loading…' : `${loaded} of ${total.toLocaleString()} shown`;
  return (
    <span className="muted" role="status" aria-live="polite">
      {text}
    </span>
  );
}
