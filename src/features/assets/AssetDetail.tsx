import { useState } from 'react';

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
   * User-facing copy for an error. Injected by App (canonical: client2's
   * messageForApiError); the default is a minimal, non-leaking fallback so this
   * component is self-contained and never shows a raw server string.
   */
  describeError?: (error: unknown) => string;
}

const defaultDescribe = () => 'Something went wrong. Please try again.';

/**
 * Detail panel on TanStack Query. Status edits are optimistic (via useUpdateAsset)
 * and a 409 version conflict is surfaced as a reconciliation prompt rather than a
 * silent discard. Focus management and the 404-thumbnail placeholder belong to
 * other tasks and are intentionally not added here.
 */
export function AssetDetail({ id, onClose, onSaved, describeError = defaultDescribe }: Props) {
  const query = useAsset(id);
  const update = useUpdateAsset(id);
  const [pendingPatch, setPendingPatch] = useState<AssetPatch | null>(null);

  const asset = query.data;

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
    <aside className="panel">
      <div className="panel__head">
        <h2>Asset detail</h2>
        <button onClick={onClose}>Close</button>
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
