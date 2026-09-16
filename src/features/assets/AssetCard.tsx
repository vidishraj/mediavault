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
  /** Double-click / Enter opens the detail panel. */
  onOpen: (id: string) => void;
  /**
   * Pointer selection: plain click selects only this card, shift-click extends the
   * range from the anchor, ctrl/cmd-click (and the checkbox) toggles one.
   */
  onPointerSelect: (id: string, mods: { shiftKey: boolean; toggle: boolean }) => void;
  /** Registers the cell's DOM node so the grid can focus it after it mounts. */
  registerRef: (id: string, el: HTMLDivElement | null) => void;
}

function AssetCardImpl({
  asset,
  selected,
  active,
  tabIndex,
  onOpen,
  onPointerSelect,
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
      onClick={(e) =>
        onPointerSelect(asset.id, { shiftKey: e.shiftKey, toggle: e.metaKey || e.ctrlKey })
      }
      onDoubleClick={() => onOpen(asset.id)}
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
        tabIndex={-1}
        onClick={(e) => {
          // The checkbox owns its own pointer interaction: stop the card's click,
          // suppress the native toggle (the `checked` prop is state-driven), and
          // route through the grid so shift-click extends the range and a plain
          // click toggles just this card.
          e.stopPropagation();
          e.preventDefault();
          onPointerSelect(asset.id, { shiftKey: e.shiftKey, toggle: !e.shiftKey });
        }}
        onChange={() => {}}
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
