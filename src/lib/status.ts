import type { AssetStatus } from './types';

/**
 * The asset lifecycle, in order. The four statuses are a PROGRESSION, not four
 * unrelated states: draft -> in review -> approved -> archived. The UI leans on
 * that order (colour warms from neutral to green, then cools to a retired
 * slate) so the set reads as a pipeline at a glance.
 */
export const STATUS_ORDER: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

export interface StatusMeta {
  label: string;
  /** One-line intent, used in tooltips and the detail panel. */
  description: string;
  /**
   * A shape-distinct glyph. This is the SECOND CHANNEL: status is never carried
   * by colour alone, so it stays legible for a viewer who cannot separate red
   * from green. The glyph plus the always-present text label carry the meaning;
   * colour only reinforces it.
   */
  icon: string;
  /** 1-based position in the lifecycle, so the UI can render it as a progression. */
  step: number;
}

export const STATUS_META: Record<AssetStatus, StatusMeta> = {
  draft: {
    label: 'Draft',
    description: 'Not yet submitted for review',
    icon: '✎', // pencil
    step: 1,
  },
  in_review: {
    label: 'In review',
    description: 'Waiting on a reviewer',
    icon: '◐', // half-filled circle (work in progress)
    step: 2,
  },
  approved: {
    label: 'Approved',
    description: 'Cleared for use',
    icon: '✓', // check mark
    step: 3,
  },
  archived: {
    label: 'Archived',
    description: 'Retired from active use',
    icon: '▣', // boxed square (filed away)
    step: 4,
  },
};

export function statusMeta(status: AssetStatus): StatusMeta {
  return STATUS_META[status];
}
