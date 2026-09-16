# Search correctness — design decisions (Task 1)

Draft of the "what I did / what I rejected / why" for search. Folds into SUBMISSION.md when the
code lands. The three questions the live round asks — *where does a keystroke go, and what stops a
stale response landing?* — are answered here. Two problems that look like one but are not:
**correctness** (never show the wrong rows) and **rate budget** (never trip 80 req/10s). They need
different fixes.

## 1. Stale response never lands — correctness

**What I did.** The query (q + status + kind + tag + sort) is the identity of the request. Data is
fetched with TanStack Query keyed on that identity, and only the *active* key's data is ever
rendered, so a response for a superseded query cannot be written into the current view — the
overwrite in the baseline (`useAssets` calls `setState` with whatever `.then` resolves last) is
structurally gone. On top of that, the request for a superseded query is **cancelled**, not merely
ignored: the query function receives an `AbortSignal` (from the transport, wb-u11) and passes it to
`fetch`, so an in-flight "st" request is aborted the moment the query becomes "studio". Cancelled
frees the connection and, critically, stops a doomed request from counting against the rate budget.

**What I rejected.**
- *A sequence/request-id guard inside the existing hook* (record the latest id, drop older
  responses on arrival). It fixes the symptom but leaves the request running to completion — it
  ignores, does not cancel — so it still burns a slow +700ms request against the 80/10s budget. And
  it is bespoke state we would have to prove correct; keying on the query is the same guarantee for
  free.
- *Relying on cancellation alone.* Abort fixes correctness but not the budget (see §2): you still
  issue one request per keystroke.

**Evidence it was real.** `notes/baseline/` — the stale two-char "st" response (3397 rows) lands
after the finished "studio" query (1710 rows) and wins, on every captured run.

## 2. Ordinary typing does not trip the rate limit — the budget

**What I did: a 250 ms trailing debounce on `q`.** Chosen, and defensible on camera:

- The ceiling is 80 requests / rolling 10 s ≈ 8 req/s, shared with detail fetches, facets, and
  batch/bulk — and **retries count against it** (the designed trap). Search alone must stay a small
  fraction of that.
- Un-debounced, a 6-character word is 6 requests in ~1 s (measured: baseline fires exactly 6). A
  250 ms trailing debounce collapses a burst of typing into **one** request at the pause — a ~6x
  cut — so sustained searching stays well under budget with headroom for everything else.
- 250 ms is below the ~300 ms threshold where a delay starts to feel laggy, so it reads as instant
  after you stop typing, while still swallowing the whole burst.
- A useful side effect: the slowest, least useful requests are the 1–2 char prefixes (the server
  adds +700 ms to them). They are typed *inside* the debounce window and so never fire at all.

**What I rejected.**
- *Throttle.* Throttle emits at a steady cadence *during* continuous input, which for a search box
  means firing the intermediate prefixes we do not care about. Only the settled query matters, and
  trailing debounce yields exactly that. Throttle is the right tool for scroll/resize (continuous,
  you want periodic samples), the wrong one here.
- *No debounce, lean on cancellation.* Correct rows, wrong budget: still one request per keystroke,
  still trips 80/10s under sustained typing, and cancelled-mid-flight requests can still have
  counted on the way in. Cancellation and debounce solve different problems; I need both.
- *A hard min-length (e.g. ignore q < 2).* Tempting given the +700 ms penalty, but the debounce
  already neutralises the cost, and searching from the first character is better UX. Kept as a
  cheap option, not shipped.

## 3. Query state in the URL — reload and share restore the view

**What I did.** `q`, `status`, `kind`, `tag`, `sort` live in the URL query string. Reload or paste
the link and the exact view comes back. The write strategy is split:

- **`replaceState` while typing `q`.** Typing is a continuous edit of one field; six keystrokes of
  "studio" must be **one** back-button step, not six. So each debounced `q` update *replaces* the
  current history entry.
- **`pushState` on a committed filter change.** Toggling a status, adding a tag, or changing the
  sort is a discrete, intentional transition between distinct views — the kind of thing a user
  expects Back to undo. Those *push* a new entry.

The rule: continuous editing replaces, discrete commits push. Back/Forward then walks meaningful
states, never keystrokes.

**What is deliberately NOT in the URL.** The **cursor / pagination position**. A cursor is bound to
the query that produced it (`API.md`), so a shared or reloaded cursor would be stale — and
`stale_cursor` must be unreachable (see §4). Selection and the open-detail id are transient UI, out
of scope here.

## 4. Changing a filter resets pagination — `stale_cursor` is unreachable by construction

**What I did.** The cursor is not part of the query identity and is dropped on *any* query change.
With an infinite query keyed on (q, status, kind, tag, sort), changing any of them starts a fresh
query from page one; the previous cursor is never carried across a query boundary, so the server is
never asked to honour a cursor from a different query. `400 stale_cursor` is therefore *structurally
unreachable* — a user cannot see it — rather than caught-and-swallowed after the fact. Catching it
after would mean the bad request was already sent (and already counted against the budget).

## 5. Loading, empty, and error are three distinct states

**What I did.** Never conflate them (the baseline does — see `notes/baseline/`):
- **Loading** — a real loading state (skeletons/spinner), distinct from an empty grid.
- **Empty** — a successful response with zero rows: "Nothing matches these filters."
- **Error** — a failed request: an error state that does **not** masquerade as empty, and does
  **not** silently present stale rows as if they were fresh. If we keep the last good rows during a
  background refetch, they are marked as stale, not shown under a bare error banner as the baseline
  does.

## 6. The list-hook contract (agreed with the grid owner)

`useAssetList(query)` — one `useInfiniteQuery` over `listAssets(query, { signal })`, keyed on the
query **excluding** the cursor. The return shape is fixed so the grid + virtualiser build against it
once:

```ts
{
  assets: Asset[];            // flat, APPEND-ONLY within a query (pages accumulate; existing items
                              //   keep their index so focus/scroll are stable across fetchNextPage);
                              //   re-derived only when pages change, memoised so the reference is
                              //   stable between renders when nothing changed; resets to page one on
                              //   any query change (new key).
  total: number;              // full FILTERED count from the server (not the loaded count) — the grid
                              //   reserves scroll height / skeleton rows from it (no layout shift).
  status: 'loading' | 'ready' | 'empty' | 'error';
                              // 'loading' = FIRST page only (full skeleton grid). NEVER set during a
                              //   next-page fetch. 'empty' = successful, zero rows. 'error' =
                              //   whole-query / first-page failure only.
  error: ApiError | null;     // set with status==='error'.
  fetchNextPage: () => Promise<unknown>; // rejects on a next-page failure (does NOT flip status).
  hasNextPage: boolean;
  isFetchingNextPage: boolean;           // the incremental one — grid shows an inline "loading more".
  isFetchNextPageError: boolean;         // next-page failure SEAM: grid stays mounted, keeps rows,
  nextPageError: ApiError | null;        //   shows a retryable "couldn't load more" affordance.
  refetch: () => void;
}
```

**Why the seams matter.** A failed next-page fetch (the 6% 503 / 429 chaos) must never discard the
loaded rows or flip the whole grid to an error state — it is surfaced separately so the grid keeps
its rows and offers a retry. `status:'error'` is reserved for a first-page/whole-query failure. This
is the Task 2 resilience seam.

**Live updates are identity-stable.** When an `asset.updated` event (SSE, ~6s) or a write is
reconciled into the cache, it is an **in-place patch of the same `id`** — the row object's identity
is preserved, never replaced wholesale or reordered on the live tick — so the grid does not lose
focus or scroll position. Deliberate trade-off: if the update changes the active sort key (e.g.
`updatedAt` under `updatedAt:desc`), the row is **not** re-sorted on the tick; re-sorting happens
only on an explicit refetch or query change. Stability on a 6-second heartbeat beats a correct-but-
jumpy re-sort. (Open: who owns the `EventSource` subscription itself — raising separately.)
