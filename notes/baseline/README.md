# Baseline evidence — search (Task 1), captured on `33f0e66`

Captured **before any modification**, on the unmodified vendor baseline (`33f0e66`, the
byte-identical vendor zip), because the "before" state cannot be recovered once the transport
foundation lands.

**How measured.** Node 20 `fetch` driving the API directly, so the request/response ordering is
observed at the network layer where the race actually lives — not inferred. The mock API
(`server/index.mjs`) was run with **chaos ON and latency ON** (`{"ok":true,"assets":12400,
"chaos":true,"latency":true}`), which is how the graders run it. A browser DevTools session was
not used for this capture; the stale-response race is a network-ordering phenomenon and is fully
visible at the request layer, with `x-request-id` logged per call. Every number below is observed,
not estimated. Timings vary run to run because the server randomises latency, but the *outcome*
(the short prefix arrives last) reproduced on every run.

**Isolation (why these numbers are trustworthy).** The request count and timings were captured
against **my own API instance on my own port** (`PORT=8801 node server/index.mjs`), not the shared
`:8787` dev instance. The mock's rate limiter keys on `req.socket.remoteAddress`
(`server/index.mjs:41–46, 184`), which is `localhost` for every process on the box, so the shared `:8787`
is a single 80-req/10s bucket shared by everything on the machine — a `429` there could be unrelated traffic,
and this request count is scored. A separate process has its own in-memory limiter, so driving
`:8801` directly is contamination-free. The three captured runs show zero `429`/rate errors.

- Machine: `Linux 5.15.0-… x86_64` (see `search-race-capture.txt` header for the exact `uname`/node).
- Repro script: [`reproduce-search-race.mjs`](./reproduce-search-race.mjs). Raw runs:
  [`search-race-capture.txt`](./search-race-capture.txt).

---

## 1. A slow response from an earlier query overwrites a newer one (the race)

**Mechanism (server, frozen).** `latencyFor()` in `server/index.mjs` adds **+700 ms** for
`q.length <= 2` and **+320 ms** for `q.length <= 4`, on top of a 90–350 ms base. Short prefixes are
deliberately the slowest, so responses arrive out of order — `API.md` says so outright: *"Latency
rises for broad queries and short `q` prefixes, so responses can and do arrive out of order."*

**Why the baseline shows the wrong rows.** The client has no cancellation and no de-duplication
(`src/api/client.ts` header lists both as known gaps), and `useAssets` applies **whatever resolves
last** with no ordering guard: the `.then()` at `src/features/assets/useAssets.ts:29` calls
`setState` with that response's items regardless of whether a newer query has since been typed. So
the last response to *arrive* wins, not the last query *issued*.

**Reproduction.** Typed `studio` one character at a time (~70 ms between keystrokes), fixed
`sort=name:asc` so any row difference is purely the filter. Representative run:

```
SENT ORDER (what the user typed):
  q="s"        sent@   0ms recv@ 980ms  total=9746   first3=a_00625,a_01035,a_01138
  q="st"       sent@ 127ms recv@1045ms  total=3397   first3=a_00625,a_01317,a_03192
  q="stu"      sent@ 198ms recv@ 869ms  total=1710   first3=a_08449,a_08505,a_11492
  q="stud"     sent@ 269ms recv@ 836ms  total=1710   first3=a_08449,a_08505,a_11492
  q="studi"    sent@ 342ms recv@ 472ms  total=1710   first3=a_08449,a_08505,a_11492
  q="studio"   sent@ 413ms recv@ 601ms  total=1710   first3=a_08449,a_08505,a_11492

ARRIVAL ORDER (what actually came back):
  recv@ 472ms  q="studi"   total=1710
  recv@ 601ms  q="studio"  total=1710   <- correct result, arrives 5th
  recv@ 836ms  q="stud"    total=1710
  recv@ 869ms  q="stu"     total=1710
  recv@ 980ms  q="s"       total=9746
  recv@1045ms  q="st"      total=3397   <- STALE result, arrives last and wins

User finished typing:      q="studio"  total=1710  first3=a_08449,a_08505,a_11492
Last response to arrive:   q="st"      total=3397  first3=a_00625,a_01317,a_03192
```

The correct `studio` result (1710 rows, first `a_08449`) came back at 601 ms, but the stale two-key
`st` result (3397 rows, first `a_00625`) came back last at 1045 ms. The baseline applies the last
arrival, so **the grid ends up showing the broad `st` result set after the user has finished typing
`studio`** — visibly the wrong rows, and a different `total` in the header. Reproduced on all three
captured runs.

## 2. How many requests a 6-character query fires

**6** — one `GET /api/assets` per keystroke (`s`, `st`, `stu`, `stud`, `studi`, `studio`), because
the search input calls `setQ` on every `onChange` (`src/App.tsx:64`) and `useAssets` re-fetches on
every distinct query. Nothing is debounced (`src/App.tsx:25` says so in a comment). The initial
mount fires **1** more request at `q=""`, separate from typing.

Caveat, stated so the number is defensible: the app mounts under `<StrictMode>`
(`src/main.tsx`), which double-invokes effects **in dev only**, so a dev session shows 12 while
typing. The production build (and the network-level repro above, which uses the raw client) fire
**6**. The meaningful figure is 6 requests per 6-character query.

## 3. Loading, empty, and error are not distinguishable

Confirmed by tracing the state machine in `useAssets.ts` against the render branches; the 503 path
was shown to be live (forced `503 upstream_unavailable` — "Search index is warming up." — within
20 calls, matching the ~6% rate in `API.md`).

- **Failed reload leaves stale rows under an error banner.** The catch at
  `useAssets.ts:38` does `setState((s) => ({ ...s, loading: false, error }))` — it **spreads the
  previous `items`**. So after a successful load, a failed reload (a 503, or a `429` once typing
  trips the rate limit) keeps the *old* rows on screen with a red error line above them
  (`App.tsx:108`), and nothing marks those rows as stale.
- **A failed first load is identical to an empty result.** On mount `items` is `[]`
  (`useAssets.ts:18`); if the first request fails, the catch spreads `...s` with `items` still `[]`,
  so `AssetGrid` hits `assets.length === 0` and renders **"Nothing matches these filters."**
  (`AssetGrid.tsx:18`) — the exact empty-state copy — while `App.tsx:108` also shows the error. A
  genuine empty result and a failed first load render the same view.

So "empty" and "error" collapse into one view, and "loading" is only distinguished by a separate
`loading` flag on the count line (`App.tsx:91`). All three need to become distinct states.
