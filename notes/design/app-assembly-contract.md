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
Controls (search, sort, status, kind)        ← builder (App)
ResultCount(loaded, total, status)           ← client2 (shell copy)
status === 'error' → QueryErrorBanner        ← client2 (top banner, whole-query failure)
status === 'empty' → EmptyState              ← client2 (whole-view, zero rows)
status ∈ {loading, ready} → AssetGrid        ← client (skeleton on loading, rows on ready,
                                                  inline "loading more" / "couldn't load more")
BulkBar, AssetDetail                          ← Task 3 (unchanged for now)
```

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
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}
```

`status === 'error'` and `status === 'empty'` never reach the grid — App renders the shell for
those, so the grid is only ever "loading skeleton" or "rows (+ optional inline next-page affordance)".

## Shell components — client2 (wb-dqu)

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
