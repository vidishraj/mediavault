/**
 * Single-asset query for the detail panel.
 *
 * Converts the baseline panel (useEffect + useState calling getAsset) onto
 * TanStack Query under the key `['asset', id]` (singular — it never collides with
 * the plural `['assets', {filters}]` list key). Putting the open asset in the
 * cache is what lets an optimistic edit and a bulk change reflect in the panel,
 * and what lets the 409 path refetch the authoritative version.
 */

import { useQuery } from '@tanstack/react-query';

import { getAsset } from '@/api/client';
import type { Asset } from '@/lib/types';

export const assetKey = (id: string) => ['asset', id] as const;

export function useAsset(id: string | null) {
  return useQuery<Asset>({
    queryKey: assetKey(id ?? ''),
    queryFn: ({ signal }) => getAsset(id as string, { signal }),
    enabled: id != null,
  });
}
