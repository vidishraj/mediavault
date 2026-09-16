# App assembly contract

App.tsx has one owner (search/builder) who composes components delivered by others. This is the
props contract each component is built to, so nobody writes grid or copy behaviour inside App.tsx.
App owns: the query hooks (`useUrlAssetQuery` + `useDebouncedValue` + `useAssetList`), the search /
sort / status / kind controls, selection and open-detail state, and the composition below. If a
behaviour needs to live in App that belongs in a component, that is a contract gap to raise here,
not logic to absorb.

## What App passes down (from `useAssetList`)

```ts
const list = useAssetList({ ...query, q: debouncedQ, limit: 24 });
// list: { assets, total, status, error, fetchNextPage, hasNextPage,
//         isFetchingNextPage, isFetchNextPageError, nextPageError, refetch }
```

## Composition (who renders what, keyed on `list.status`)

```
OfflineBanner (persistent, top)              ← client2 (self-contained, no props)
Controls (search, sort, status, kind)        ← builder (App)
BulkBar (when selection non-empty)           ← client2 presentational, fed by builder2's action
ResultCount(loaded, total, status)           ← client2 (shell copy)
status === 'error' → QueryErrorBanner        ← client2 (top banner, whole-query failure)
status === 'empty' → EmptyState              ← client2 (whole-view, zero rows)
status ∈ {loading, ready} → AssetGrid        ← client (skeleton on loading, rows on ready,
                                                  inline "loading more" / "couldn't load more")
AssetDetail                                   ← builder2 (Task 3; RQ ['asset', id])
```

Shell components import from `@/components/*` (client2). `messageForApiError(error): string | null`
lives in `@/lib/messages` (client2); App swaps `describeError` for it the moment it is on main.

## Selection — one store (builder2), App bridges it into props

builder2 owns a single headless selection store (`useSelection`). App reads it and threads the three
selection props so the grid stays props-driven and imports no store:

```
selectedIds   ← store.selectedIds
onToggleSelect ← store.toggle            // Space; also sets the anchor
onSelectRange  ← (ids) => store.replaceWith(ids)   // Shift+Arrow; grid computes the id range
```

Anchor + range math live in the grid (all range gestures originate there); the store needs no
`extendTo`. `AssetGridProps` is unchanged by this — App just sources the props from the store instead
of a local `useState` Set.

## Bulk — presentation (client2) + action (builder2), composed by App

To avoid two bulk-bar owners: the BAR is presentational (client2), the ACTION is a data hook
(builder2). App wires them.

```ts
// Presentational bar (interface layer, imports from @/components):
function BulkBar(props: {
  selectedCount: number;
  onApply: (status: AssetStatus) => void;
  onClear: () => void;
  outcome: BulkOutcomeLike | null;      // partitioned {succeeded/failed/retryable/permanent}; the
  onRetry: () => void;                  //   bar shows "Try again" only when retryableIds is
  isApplying?: boolean;                 //   non-empty; legal-hold items are stated plainly as
}): JSX.Element;                        //   unchangeable, no button. Persists while outcome != null.

// Action hook (writes/optimistic workstream): a hook, NOT a bar.
// useBulkStatus(selectedIds) → { apply(status): void; retryRetryable(): void; result; outcome;
//   isApplying: boolean; reset(): void }  — owns chunking >50, the API call, optimistic
//   setQueriesData + rollback, 207 partial handling, and clearing the outcome on the next apply.
```

App wires: `onApply` ← `apply`, `onRetry` ← `retryRetryable`, `outcome` ← `outcome`, `isApplying` ←
`isApplying`; `selectedCount`/`onClear` ← the selection store.

## `AssetGrid` — client (Task 2)

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
  nextPageError: ApiError | null;   // copy via client2's messageForApiError, not a local string
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

The **first-page skeleton is grid-owned** (`isFirstPageLoading`), rendered through the SAME
virtualised layout so real rows replace skeleton rows with no reflow. So App routes
`status === 'loading'` to `<AssetGrid isFirstPageLoading>`, and there is NO separate shell skeleton
for first load — that would be two skeleton owners. The shell renders only `empty` and whole-query
`error`.

`status === 'error'` and `status === 'empty'` never reach the grid — App renders the shell for
those, so the grid is only ever "loading skeleton" or "rows (+ optional inline next-page affordance)".

## Shell components — the interface layer

One message table, `messageForApiError(error): string | null` (null for `aborted`). Components:

```ts
messageForApiError(error: ApiError): string | null;              // the single copy table

function ResultCount(props: { loaded: number; total: number; status: AssetListStatus }): JSX.Element;
// "Loading…" on loading; "{loaded} of {total} shown" otherwise. aria-live polite; announces on
// settled transitions, not per keystroke (the query is already debounced upstream).

function QueryErrorBanner(props: { error: ApiError; onRetry: () => void }): JSX.Element;
// Whole-query failure. role="alert". Copy from messageForApiError(error). A "Try again" -> onRetry.

function EmptyState(props?: { query?: AssetListQuery }): JSX.Element;
// Whole-view, a successful zero-row result. "Nothing matches these filters." copy owned here.
```

Until `src/lib/messages.ts` lands, App uses a local `describeError()` as a single INTERIM seam,
swapped for `messageForApiError` the moment it lands — one message table, never two.
