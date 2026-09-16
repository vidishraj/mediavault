import { memo } from 'react';
import { thumbnailUrl } from '@/api/client';
import { StatusChip } from '@/components/StatusChip';
import { formatBytes, formatDate } from '@/lib/format';
import type { Asset } from '@/lib/types';

export interface AssetCardProps {
  asset: Asset;
  /**
   * A plain boolean, deliberately NOT `isSelected(id)`. Passing a per-render
   * callback would give every card a new prop each time selection changes and
   * defeat memoisation; a boolean lets React.memo skip the 99% of cards whose
   * selected state did not change — the Task 2 "toggle one, re-render one" rule.
   */
  selected: boolean;
  active: boolean;
  /** Roving tabindex: 0 for the one focused cell, -1 for the rest. */
  tabIndex: 0 | -1;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  /** Registers the cell's DOM node so the grid can focus it after it mounts. */
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

function AssetCardImpl({
  asset,
  selected,
  active,
  tabIndex,
  onOpen,
  onToggleSelect,
  registerRef,
}: AssetCardProps) {
  const className =
    'card' + (selected ? ' card--selected' : '') + (active ? ' card--active' : '');

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      tabIndex={tabIndex}
      ref={(el) => registerRef(asset.id, el)}
      className={className}
      onClick={() => onOpen(asset.id)}
      data-index-id={asset.id}
    >
      {asset.hasThumbnail ? (
        // Decorative (empty alt): the name is the accessible label. lazy so
        // off-screen thumbs never fetch; onError degrades to the reserved-size
        // placeholder so a stray 404 causes no broken image and no layout shift.
        <img
          className="card__thumb"
          src={thumbnailUrl(asset.id)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <div className="card__thumb card__thumb--placeholder" aria-hidden="true" />
      )}
      <div className="card__body">
        <p className="card__name">{asset.name}</p>
        <p className="muted">
          {asset.kind} · {formatBytes(asset.sizeBytes)} · {formatDate(asset.updatedAt)}
        </p>
        <StatusChip status={asset.status} />
      </div>
      <input
        type="checkbox"
        className="card__check"
        checked={selected}
        aria-label={`Select ${asset.name}`}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleSelect(asset.id)}
        tabIndex={-1}
      />
    </div>
  );
}

/**
 * Memoised: re-renders only when this card's own props change. Because `selected`
 * is a boolean and the callbacks are referentially stable (the grid holds them in
 * refs), toggling one selection re-renders exactly one card.
 */
export const AssetCard = memo(AssetCardImpl);
