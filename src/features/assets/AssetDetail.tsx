import { useEffect, useRef, useState } from 'react';

import { thumbnailUrl } from '@/api/client';
import { formatBytes, formatDate, formatDuration, statusLabel } from '@/lib/format';
import type { Asset, AssetStatus } from '@/lib/types';
import { useAsset } from './useAsset';
import { type AssetPatch, useUpdateAsset } from './useUpdateAsset';

const STATUSES: AssetStatus[] = ['draft', 'in_review', 'approved', 'archived'];

interface Props {
  id: string;
  onClose: () => void;
  /** Kept for the App contract; the cache patch drives the grid, so this is a no-op there. */
  onSaved?: (asset: Asset) => void;
  /**
   * User-facing copy for an error. Injected by App (canonical:
   * `messageForApiError` in `@/lib/messages`); the default is a minimal,
   * non-leaking fallback so this component is self-contained and never shows a
   * raw server string.
   */
  describeError?: (error: unknown) => string;
}

const defaultDescribe = () => 'Something went wrong. Please try again.';

/**
 * Detail panel on TanStack Query. Status edits are optimistic (via useUpdateAsset)
 * and a 409 version conflict is surfaced as a reconciliation prompt rather than a
 * silent discard. Non-modal: focus moves in on open and restores to the opening
 * card on close, Escape closes it from anywhere, and focus is deliberately NOT
 * trapped (the brief requires no focus traps). The 404-thumbnail placeholder
 * belongs to another task and is not added here.
 */
export function AssetDetail({ id, onClose, onSaved, describeError = defaultDescribe }: Props) {
  const query = useAsset(id);
  const update = useUpdateAsset(id);
  const [pendingPatch, setPendingPatch] = useState<AssetPatch | null>(null);

  const asset = query.data;
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus management (non-modal side panel — the brief requires NO focus traps):
  // move focus into the panel on open, restore it to the card that opened it on
  // close. Focus is deliberately NOT trapped; the user can Tab out to the grid.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Escape closes the panel from ANYWHERE while it is open. Because the panel is
  // non-modal, focus may be outside it (the user tabbed back to the grid), and a
  // panel-scoped handler silently stops firing there — the exact defect this
  // avoids. A document-level listener, live only while the panel is mounted, keeps
  // Escape working wherever focus sits.
  useEffect(() => {
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [onClose]);

  function saved(updated: Asset) {
    setPendingPatch(null);
    onSaved?.(updated);
  }

  function applyStatus(status: AssetStatus) {
    if (!asset) return;
    const patch: AssetPatch = { status };
    setPendingPatch(patch);
    update.mutate({ version: asset.version, patch }, { onSuccess: saved });
  }

  // Keep-mine: re-apply the user's edit against the freshly refetched version.
  function keepMine() {
    if (!asset || !pendingPatch) return;
    update.mutate({ version: asset.version, patch: pendingPatch }, { onSuccess: saved });
  }

  function takeTheirs() {
    setPendingPatch(null);
    update.reset();
  }

  return (
    <aside
      className="panel"
      role="region"
      aria-labelledby="asset-detail-heading"
    >
      <div className="panel__head">
        <h2 id="asset-detail-heading">Asset detail</h2>
        <button ref={closeRef} onClick={onClose}>
          Close
        </button>
      </div>

      {query.isLoading && <p className="muted">Loading…</p>}
      {query.isError && !asset && <p className="error">{describeError(query.error)}</p>}

      {update.conflict && (
        <div className="conflict" role="alert">
          <p>This asset changed since you opened it. It is now “{asset ? statusLabel(asset.status) : '—'}”.</p>
          <div className="row">
            <button onClick={keepMine}>Apply my change anyway</button>
            <button onClick={takeTheirs}>Keep the current version</button>
          </div>
        </div>
      )}
      {update.isError && !update.conflict && <p className="error">{describeError(update.error)}</p>}

      {asset && (
        <div className="panel__body">
          <img className="panel__thumb" src={thumbnailUrl(asset.id)} alt="" />
          <h3>{asset.name}</h3>
          <dl className="facts">
            <dt>Id</dt>
            <dd>{asset.id}</dd>
            <dt>Kind</dt>
            <dd>{asset.kind}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(asset.sizeBytes)}</dd>
            {asset.width && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width}×{asset.height}
                </dd>
              </>
            )}
            {asset.durationSec && (
              <>
                <dt>Duration</dt>
                <dd>{formatDuration(asset.durationSec)}</dd>
              </>
            )}
            <dt>Owner</dt>
            <dd>{asset.owner.name}</dd>
            <dt>Updated</dt>
            <dd>{formatDate(asset.updatedAt)}</dd>
            <dt>Version</dt>
            <dd>{asset.version}</dd>
          </dl>

          {asset.tags.length > 0 && (
            <ul className="tags">
              {asset.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}

          <p className="muted">Status</p>
          <div className="row">
            {STATUSES.map((status) => (
              <button
                key={status}
                disabled={update.isPending || status === asset.status}
                onClick={() => applyStatus(status)}
              >
                {statusLabel(status)}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
