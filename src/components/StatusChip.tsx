import { STATUS_ORDER, statusMeta } from '@/lib/status';
import type { AssetStatus } from '@/lib/types';

/**
 * Status shown as icon + label. The glyph is decorative to assistive tech (the
 * text label is the accessible name) but load-bearing visually as the non-colour
 * channel, so status never rests on colour alone. A visually-hidden "step N of 4"
 * lets a screen-reader user perceive the lifecycle; the description is a tooltip.
 */
export function StatusChip({ status }: { status: AssetStatus }) {
  const meta = statusMeta(status);
  return (
    <span className={`status status--${status}`} title={meta.description}>
      <span className="status__icon" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
      <span className="sr-only"> (step {meta.step} of {STATUS_ORDER.length})</span>
    </span>
  );
}
