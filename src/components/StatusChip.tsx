import { statusMeta } from '@/lib/status';
import type { AssetStatus } from '@/lib/types';

/**
 * Status shown as icon + label, never colour alone. The label text is the
 * accessible name; the icon is decorative reinforcement (aria-hidden), and the
 * description rides along as a tooltip.
 */
export function StatusChip({ status }: { status: AssetStatus }) {
  const meta = statusMeta(status);
  return (
    <span className={`status status--${status}`} title={meta.description}>
      <span className="status__icon" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}
