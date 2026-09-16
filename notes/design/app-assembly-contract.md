# App composition contract

App.tsx is the single composition root. It owns no grid or copy behaviour of its own: it wires
together presentational components and headless hooks, each of which owns exactly one surface. This
document fixes those boundaries and the props each surface is built to, so behaviour always lives in
the module that owns the surface, never inline in App. App owns the query hooks (`useUrlAssetQuery` +
`useDebouncedValue` + `useAssetList`), the search / sort / status / kind controls, selection and
open-detail state, and the composition below. If a behaviour that belongs to a component would
otherwise have to live in App, that is a boundary gap to record here, not logic to absorb.

## What App passes down (from `useAssetList`)

```ts
const list = useAssetList({ ...query, q: debouncedQ, limit: 24 });
// list: { assets, total, status, error, fetchNextPage, hasNextPage,
//         isFetchingNextPage, isFetchNextPageError, nextPageError, refetch }
```

## Composition (which surface renders when, keyed on `list.status`)

```
OfflineBanner (persistent, top)              — self-contained, no props
Controls (search, sort, status, kind)        — App
BulkBar (when selection non-empty)           — presentational; fed by the bulk action hook
ResultCount(loaded, total, status)           — shell copy
status === 'error' → QueryErrorBanner        — top banner, whole-query failure
status === 'empty' → EmptyState              — whole-view, zero rows
status ∈ {loading, ready} → AssetGrid        — skeleton on loading, rows on ready,
                                                 inline "loading more" / "couldn't load more"
AssetDetail                                   — Task 3; RQ ['asset', id]
```

Shell components live under `@/components/*`. Failure copy is rendered through
`describeError(err: unknown): string | null` from `@/lib/messages` — one message table for the whole
app, never a local duplicate.

## Selection — a single headless store, bridged into props

A single headless selection store (`useSelection`) owns the selection set. App reads it and threads
the three selection props so the grid stays props-driven and imports no store:

```
selectedIds    ← store.selectedIds
onToggleSelect ← store.toggle            // Space; also sets the anchor
onSelectRange  ← (ids) => store.replaceWith(ids)   // Shift+Arrow; grid computes the id range
```

Anchor + range math live in the grid (all range gestures originate there); the store needs no
`extendTo`. `AssetGridProps` is unchanged by this — App sources the props from the store instead of a
local `useState` Set.

## Bulk — a presentational bar + an action hook, composed by App

To keep one owner per concern, the BAR is presentational and the ACTION is a data hook. App wires
them together.

```ts
// Presentational bar (under @/components):
function BulkBar(props: {
  selectedCount: number;
  onApply: (status: AssetStatus) => void;
  onClear: () => void;
  outcome: BulkOutcomeLike | null;      // partitioned {succeeded/failed/retryable/permanent}; the
  onRetry: () => void;                  //   bar shows "Try again" only when a retryable subset
  canRetry?: boolean;                   //   exists AND no run is in flight (falls back to exactly
  onDismiss?: () => void;               //   that rule if omitted); legal-hold items are stated
  isApplying?: boolean;                 //   plainly as unchangeable, no button. The banner persists
}): JSX.Element;                        //   while outcome != null; onDismiss clears it.

// Action hook (writes / optimistic path): a hook, NOT a bar.
// useBulkStatus(selectedIds) → { apply(status): void; retryRetryable(): void; result; outcome;
//   canRetry: boolean; isApplying: boolean; reset(): void }
//   — owns chunking to the id cap, the API call, optimistic setQueriesData + rollback, 207 partial
//   handling, 409 refetch-and-reconcile, and clearing the outcome on the next apply. The outcome
//   deliberately SURVIVES a retry (a permanent failure must not vanish); it clears only on a fresh
//   apply, on reset(), or on the next selection change. retryRetryable() is a no-op while a run is
//   in flight, so a double-click cannot double-spend the rate budget.
```

App wires: `onApply` ← `apply`, `onRetry` ← `retryRetryable`, `outcome` ← `outcome`, `canRetry` ←
`canRetry`, `isApplying` ← `isApplying`; `selectedCount` / `onClear` ← the selection store;
`onDismiss` ← `() => bulk.reset()`. App also calls `bulk.reset()` whenever the selection changes, so a
prior run's outcome banner can never sit above a new selection. The banner is bulk state, so it is
`bulk.reset()` that clears it — the selection store's own clear is a separate concern.

## `AssetGrid` (Task 2)

The grid owns the infinite-scroll trigger (observe the virtual range nearing the loaded end and call
`onFetchNextPage`), the first-page skeleton, and the inline pagination affordances. Props:

```ts
interface AssetGridProps {
  // data (from useAssetList) — assets is flat, append-only, stable-ref, keyed by asset.id
  assets: Asset[];
  total: number;                    // reserve scroll height / skeleton rows from this
  isFirstPageLoading: boolean;      // list.status === 'loading' → full skeleton grid
  // pagination — the grid calls onFetchNextPage when the range nears the end
  hasNextPage: boolean;
  isFetchingNextPage: boolean;      // inline "loading more" footer, rows kept
  isFetchNextPageError: boolean;    // inline "couldn't load more" + retry, rows kept
  nextPageError: ApiError | null;   // copy via messageForApiError, not a local string
  onFetchNextPage: () => void;
  // selection + open (App-level state)
  selectedIds: Set<string>;
  activeId: string | null;
  onToggleSelect: (id: string) => void;        // Space toggles one and sets the anchor
  onSelectRange: (ids: string[]) => void;      // Shift+Arrow: grid computes the ordered
                                               //   anchor→focus id range; App sets the selection
  onOpen: (id: string) => void;
}
```

The card takes a `selected: boolean` (not `isSelected`), so a card re-renders only when its own
selection changes.

The **first-page skeleton is grid-owned** (`isFirstPageLoading`), rendered through the SAME
virtualised layout so real rows replace skeleton rows with no reflow. So App routes
`status === 'loading'` to `<AssetGrid isFirstPageLoading>`, and there is NO separate shell skeleton
for first load — that would be two places rendering a first-load skeleton. The shell renders only
`empty` and whole-query `error`.

`status === 'error'` and `status === 'empty'` never reach the grid — App renders the shell for
those, so the grid is only ever "loading skeleton" or "rows (+ optional inline next-page affordance)".

## Shell components (interface layer)

One message table, `messageForApiError(error): string | null` (null for `aborted`). Components:

```ts
messageForApiError(error: ApiError): string | null;              // the single copy table

function ResultCount(props: { loaded: number; total: number; status: AssetListStatus }): JSX.Element;
// "Loading…" on loading; "{loaded} of {total} shown" otherwise. aria-live polite; announces on
// settled transitions, not per keystroke (the query is already debounced upstream).

function QueryErrorBanner(props: { error: ApiError; onRetry: () => void }): JSX.Element;
// Whole-query failure. role="alert". Copy from messageForApiError(error). A "Try again" → onRetry.

function EmptyState(props?: { query?: AssetListQuery }): JSX.Element;
// Whole-view, a successful zero-row result. "Nothing matches these filters." copy owned here.
```

All failure copy is rendered through `describeError` from `@/lib/messages` — one message table, never
a local second copy.

## Where the contract and the built components disagree

This document was written before the components existed, so it is a prediction. Where a built
component and this contract diverge, the COMPONENT is the evidence: it was built against the real
constraints (virtualisation, focus management) the prediction could only guess at. The fix is to
adjust the wiring described here, not to bend a component back to the prediction.
