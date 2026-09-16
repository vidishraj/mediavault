# Submission

Keep this tight. Bullet points are fine. We read this before we read your code,
and a clear account of your reasoning carries real weight — including where you
chose not to do something.

## Video walkthrough

Paste your Loom (or equivalent) link here. 5–10 minutes.

**Link:**

---

## How to run it

Anything we need to know beyond `npm install && npm run dev`.

The jsdom hook tests need `NODE_ENV` unset: React's production build ships no `act`, so a minified
React under `NODE_ENV=production` cannot render in the test environment. A clean checkout has it
unset, so `npm test` (and `npm run dev`) work as-is.

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

Cross-cutting inventory (Task 0). Every row was verified to exist in the vendor baseline
(`33f0e66`) before being listed — several of the obvious-looking ones are *not* defects and were
deliberately left off (see the note below the table). "Where" is the baseline location.

| # | Defect | Where (baseline) | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Stale search response overwrites a newer query — the view applies whatever resolves last, and short prefixes are slower, so an old `st` lands after `studio` | `useAssets.ts` | Fixed — query-keyed fetch + AbortSignal; superseded requests cancelled (T1) |
| 2 | Every keystroke fires a request; nothing debounced (drives straight at the 80 req/10 s limit) | `App.tsx`, `useAssets.ts` | Fixed — 250 ms trailing debounce (6→1 per 6-char query) (T1) |
| 3 | Loading, empty and error conflated — a failed first load reads as "empty", stale rows sit under a bare banner | `useAssets.ts`, `AssetGrid.tsx` | Fixed — three distinct states (T1) |
| 4 | Query state not in the URL; reload or share loses the view | `App.tsx` | Fixed — URL-backed q/status/kind/tag/sort; replace-while-typing, push-on-commit (T1) |
| 5 | Changing a filter can reuse a cursor from the prior query (`400 stale_cursor`) | `App.tsx` | Fixed — cursor excluded from the query key, so the bad request is unreachable, not caught (T1) |
| 6 | Errors flattened to a raw string (`${status}: message`) shown to the user; no structured code, no human copy, retryable indistinguishable from permanent | `client.ts`, `App.tsx` | Fixed — structured `ApiError` taxonomy (W1) + code-keyed message table (T6) |
| 7 | No retry/backoff, no client-side rate limiting, no request de-dup — a bad network fails hard and any retry would amplify into the 80/10 s trap | `client.ts` | Fixed — single retry executor (full-jitter, honours `Retry-After`) + one client-wide sliding-window limiter (~70/10 s) + shared in-flight GETs (T4/W1) |
| 8 | Bulk is broken end to end — the 25 (batch) and 50 (bulk) id caps are unenforced (a large selection is one over-cap call), `207` partial success and `PATCH 409` go unhandled, and failure surfaces to the user as a bare "N updated, M failed" with no reasons, retry, or legal-hold distinction | `client.ts`, `App.tsx` | Fixed — chunk at each cap, per-id `207` partitioning, optimistic write + rollback + `409` reconcile (T3); per-reason outcome copy, retry re-sends only the retryable subset (T6) |
| 9 | Grid not keyboard operable — the card is a `<div onClick>` with no role/tabindex/keydown, the selection checkbox is unnamed, and selected state is never exposed to assistive tech | `AssetGrid.tsx` | Fixed — roving-tabindex grid, Enter/Space/arrows, `aria-selected`, labelled checkbox (T5) |
| 10 | Renders every filtered asset (up to 12,400 cards) and re-renders all cards on any selection change | `AssetGrid.tsx` | Fixed — TanStack Virtual (viewport-bounded) + per-card memo keyed on own selected state (T2) |
| 11 | Thumbnails ignore `hasThumbnail`, use no `loading="lazy"`, and have no error fallback — firing the ~4 % guaranteed 404s as broken images with layout shift | `AssetGrid.tsx`, `AssetDetail.tsx` | Fixed — gated on `hasThumbnail`, lazy, reserved-size placeholder (T2) |
| 12 | Detail panel has no dialog semantics or focus management — no `role`/`aria-labelledby`, no focus-in on open, no restore on close, no Escape | `AssetDetail.tsx` | Fixed — non-modal labelled region, focus-in on open + restore to the opening card, document-scoped Escape; deliberately no focus trap, per the brief (T5) |
| 13 | No offline state, though the brief requires one; a dropped connection surfaces only as a failed request | `App.tsx` | Fixed — persistent offline banner from the browser online/offline signal, and writes pause/resume across a drop (T6). *Knowingly left:* queuing offline **writes** for later replay — a bonus, out of scope for the window. |

**Verified NOT defects — deliberately not listed** (each looks like one and was checked against the
baseline): status is *not* colour-only — the pill renders the status **text** (`statusLabel`), the
icon we add is an enhancement; focus is *not* invisible — the baseline has a global
`:focus-visible` outline, the real gap is that the card isn't focusable (row 9); and the baseline
colour pairs **pass** WCAG AA on inspection, so there is no contrast defect to claim — tool-verified
contrast is an improvement we made, not a baseline fix.

---

## Key decisions

For each significant choice: what you did, what you rejected, and why. Three to
six of these is about right.

**Data fetching and caching** — TanStack Query. The brief allows it and treats a
well-chosen library as a positive signal; it gives me request de-dup, caching and
a single retry executor rather than hand-rolling each. The one override that
matters is scored: RQ's default retry is 3 attempts on EVERY error, which would
retry 400/409/422 and violate Task 4. I replaced it with the structural
`isRetryable` predicate plus a jittered, `Retry-After`-honouring delay. Retry
lives in exactly ONE layer (RQ); the client methods do not retry, so attempts are
never multiplied against the rate limit.

**Error taxonomy** — The API returns `{error:{code,message}}` on every failure;
the baseline flattened it to `new Error("503: msg")`, so callers could only branch
by parsing English. I parse every failure into a structured `ApiError` carrying
`code` (a closed enum of every code the server emits, plus synthesised
`network_error`/`aborted`), HTTP `status`, `x-request-id`, and any `Retry-After`.
Every downstream decision — retry, refetch-on-conflict, user copy — is a function
of the taxonomy, never of a message string. Rejected: a per-call `{retryable}`
boolean, because the retry rule belongs in one predicate, not scattered at each
call site where it drifts.

**Stale response handling** — Two problems that look like one, fixed separately.
*Correctness:* a slow response for a query the user has moved past must never overwrite the
current view. The baseline applied whatever resolved last, and the API is deliberately
slower for short prefixes, so typing `studio` left the two-key `st` result on screen —
captured in `notes/baseline/`: the correct 1,710-row result arrives at 601 ms, the stale
3,397-row `st` at 1,045 ms and wins. Fix: fetch keyed on the query (`useInfiniteQuery`), so
only the active query's data ever renders, and pass the transport's `AbortSignal` so a
superseded request is genuinely CANCELLED, not ignored — which also stops it consuming rate
budget. A test drives the same observer `useInfiniteQuery` uses and proves the finished query
wins even when the stale response lands late. The test is non-vacuous: breaking the
mechanism (making the query key stop varying by `q`, so a stale response would land in the
same cache slot) turns it red — validated by mutation, not just by a green run. *Budget:* correctness does not fix the rate
limit, so a 250 ms trailing debounce collapses a burst of typing into one request (6 → 1 for
a six-character query), sized against 80 req/10 s where retries count and the shortest
prefixes are the slowest calls. Rejected: a request-id guard (ignores, does not cancel — the
slow call still counts against the budget); throttle (fires intermediate prefixes we
discard); no-debounce-lean-on-cancel (right rows, still trips the limit). De-dup of identical
concurrent requests is free at two layers: the transport shares one in-flight GET per
`METHOD path`, and RQ shares one fetch per query key.

*Tests.* Both scored search behaviours have a test that fails if the behaviour is defeated: the
race test above; a debounce test that reddens if the delay is set to 0; and a URL test that
reddens if a keystroke pushes instead of replaces (each mutation-checked). Their tooling
(`@testing-library/react`, `jsdom`) is **dev-only** and does not ship, so the gzipped production
bundle — a scored number — is unaffected by it. The production dependencies are exactly `react`,
`react-dom` and `@tanstack/react-query`; everything else is dev tooling, so `npm audit --omit=dev`
is 0 and whatever a bare `npm audit` surfaces on a given day is dev-only and never reaches the
bundle.

**Virtualization approach** — Windowed rendering with TanStack Virtual over
ROWS, not cards: the virtualiser counts `ceil(total / columns)` rows and mounts
only the rows crossing the viewport plus a small overscan, so the DOM holds a
viewport-bounded window — ~36 gridcells for a 5,000-row list in jsdom, ~112 with
840 rows loaded when the deployed build is driven in Chrome (flat with scroll
depth) — instead of one node per asset. Column
count is derived from the measured container width via a `ResizeObserver`, so the
same virtualiser adapts from one to many columns without re-keying. Unloaded rows
render fixed-height skeletons reserved to `total`, so scrolling into
not-yet-fetched pages causes no layout shift and infinite-scroll pages replace
placeholders in place. The consequence that shapes the keyboard model: a row
outside the window has no DOM node at all, so focusing it means scrolling it into
existence first (see Accessibility). Rejected: a plain overflow list of every row
(flat DOM at 12,400 is the exact defect the brief is testing) and a hand-rolled
slice-on-scroll, which re-implements the measurement, overscan, and scroll
anchoring the library already gets right.

**Optimistic updates and rollback** — Optimistic state lives in the TanStack
Query cache, not a parallel store: a bulk status change patches the `['assets']`
list pages (and the `['asset', id]` detail) in place by id before the server
confirms. How rollback FINDS the right rows: `onMutate` snapshots the prior
status of every touched id into a Map keyed by id; on the 207 result only the
FAILED ids are restored from that snapshot, so confirmed successes keep the new
status. The two failure reasons are treated differently (the scored trap):
`legal_hold` is deterministic and PERMANENT (reported, never retried), while
`conflict` is random ~7% and RETRYABLE — recovery re-sends ONLY the retryable
subset, never re-firing legal-hold into a rate limiter that counts it. A 207
`conflict` is a 2xx so the transport can't see it; retrying just those ids is how
a bulk action recovers those ~7%. Confirmed successes also carry the server's
authoritative asset (with the incremented `version`) back into both the list and
the open detail cache, so a later single edit can't PATCH a stale version.
Membership nuance (an optimistic status change can make an item stop matching a
filtered list): the item stays visible until that list's NEXT refetch (RQ
staleness or a filter change) reconciles it — I deliberately do NOT force an
immediate invalidation, which would refetch every cached list and spend rate
budget — rather than pruning it, which would fight row keying, focus and scroll.

_Measured end to end_ (Chrome, deployed build, chaos ON; instrument: `fetch`
wrapped to capture every bulk request/response verbatim, and each rendered
asset's status captured BEFORE the apply so rollback is checked against a known
prior, not the server's own account). Selected 72, "Set archived" → **4 calls of
22 / 50 / 1 / 1 ids, max 50** — honouring the bulk-status cap, which is 50, NOT
the 25 that applies to batch fetch (two different caps in one API). First two
calls returned **207**: **64 applied, 8 failed (7 `legal_hold`, 1 `conflict`)**.
Of the 8 failures, the **5 in the rendered window each returned to their EXACT
individual prior status** (approved→approved, draft→draft, archived→archived)
while all 45 rendered successes went to archived. That result discriminates the
implementations: a blanket rollback would have reverted the 45, a blanket commit
would have left the 8 archived, and "restore one status for all" would have
failed the three different priors — only per-id rollback produces it. **"Try
again" then sent exactly ONE id** (the lone `conflict`), never the 7
deterministic `legal_hold`, so no rate-limit budget is spent on requests that can
never succeed; after it recovered, the report recomputed to 65 updated / 7 still
on legal hold and the retry affordance disappeared. Whole exercise: **7 requests,
ZERO 429s**.

**409 version conflict (single edit)** — Refetch-and-reconcile, never silent
discard. On 409 the optimistic edit is rolled back, the authoritative asset is
refetched, and the panel prompts the user to re-apply their change against the
fresh version or take the server's. Rejected: last-write-wins (silently clobbers
a colleague's change — the one thing the brief forbids) and auto-merge (produces
a row neither person chose and hides the conflict). `version_conflict` is not in
the retry set, so it never auto-retries against the same stale version.

**Retry and backoff policy** — A predicate over the taxonomy. RETRY:
`upstream_unavailable` (503), `rate_limited` (429), `write_failed` (500, marked
safe to retry in API.md), and network errors. NEVER: 400 (bad_request /
stale_cursor / …), 409 version_conflict, 422 (invalid_* / legal_hold), 404.
Backoff is exponential with FULL JITTER, a hard cap of 3 attempts, and honours a
server `Retry-After` as a floor. The rate limit (80 req/10s, retries count) is
the designed trap, so the policy is built NOT to amplify: capped attempts, jitter
so concurrent failures do not resynchronise into a second wave, and honouring the
3s `Retry-After` on a 429 instead of hammering. On top of per-request retry, the
ceiling is enforced ONCE, centrally: a single client-wide sliding-window limiter
(~70/10s for headroom) that every request acquires before `fetch`, retries
included. Per-operation concurrency does not compose — two bulk operations plus
the list queries share one budget — so the global limiter is where "a retry storm
makes things worse" is actually prevented. Rejected: matching on the message
(breaks on a reword), immediate/unbounded retry (turns one 503 into a storm), and
a fixed-window limiter (it would allow 80 at t=9.9s and 80 more at t=10.1s, 160
in one trailing window, while believing it complied). A nice property falls out:
because the limiter is acquired INSIDE the shared de-dup flight, N identical
concurrent callers cost ONE token, so de-dup saves rate budget as well as
network.

**Rate limiter trade-off (owned, not accidental)** — The central limiter buys a
guarantee we never exceed the ceiling, but it introduces head-of-line blocking:
there is no priority and no max wait, so a large background bulk (≈1300 ids →
≈26 chunks → up to ≈78 tokens) can saturate the budget and a user's foreground
search then queues behind it — up to ~11s at ~7 tokens/s. Before the limiter that
search would have been sent and possibly 429'd, so waiting is arguably better
than failing, but it is a new latency coupling between background work and
interactive search (which Tasks 1–2 score). The mitigation I did NOT build:
reserve a small slice of the budget for interactive GETs, or add a priority
argument to `acquire` so foreground requests jump the queue. Deferred as a
deliberate call for the W-level scope; it is a clean ~15-line addition on the
existing seam if foreground latency proves to matter.

**State placement and URL sync** — `q`, `status`, `kind`, `tag` and `sort` live in the URL,
so reload and share restore the exact view; the cursor does NOT, because it is bound to a
query and would go stale. The write strategy is split by the kind of change: typing `q` uses
`replaceState` so a whole typing burst is one Back step rather than one per keystroke, while
a discrete committed change (a status/kind toggle, a sort) uses `pushState` so Back/Forward
walks between meaningful views. Pagination resets on any query change by construction: the
query key excludes the cursor, so changing any field mints a new key and a fresh query from
page one — `400 stale_cursor` / `bad_cursor` are UNREACHABLE rather than caught after the bad
request was already sent. Selection and the open detail are transient UI, kept out of the
URL. Unknown enum values in a shared link are dropped, never forwarded to the API.

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | 5,000 (one DOM node per row, un-virtualised) | 36 in jsdom at 5,000 rows; ~112 in Chrome at 840 loaded (flat with scroll depth) | Two instruments for two claims. jsdom render of `AssetGrid` with 5,000 assets counting `[role="gridcell"]` (`AssetGrid.perf.test.tsx`, Node 20/Linux) proves the ALGORITHM is viewport-bounded — the test asserts the count is below the row total, so it trips if virtualisation were off. The deployed build driven in Chrome proves it HOLDS IN A REAL LAYOUT ENGINE: 112 gridcells with 840 rows loaded, and the count stays flat as scroll depth grows (77 at the top, 105 at 54,000 px, 112 at 82,953 px), while the 696 px scroller reserves 184,340 px for all 12,400 rows so the scrollbar is honest from first paint instead of growing as pages arrive. |
| Cards re-rendered when toggling one selection | 12 (every card in the rendered window) | 1 | Same file: a hoisted counter increments once per `AssetCard` render; toggling one id re-renders 1 card. The broken-memo control (a fresh callback identity) re-renders all 12, proving the counter can reach N and that the "1" is memoisation, not an inert test. |
| Names indistinguishable at a glance (two visible cards whose name truncates to the same string, at viewport scale) | 35 of 56 visible names (62.5%; 12 groups — "Weekend Mar…" ×5, "Warehouse Fl…" ×5) | 0 of 56 (0 groups) | Canvas `measureText` on each name's visible prefix at the card's computed font, before and after on the SAME 56-name population, on the deployed build. "At a glance" is viewport scale — what is on screen at once. The instrument fires at the pre-fix geometry (35 ambiguous), so it is a control, not an assertion that cannot fail. Honest limit: across a larger scrolled population (340 distinct names) collisions reappear (30 groups) because these generated names share long prefixes ("Rooftop Garden Overhead MV-…"), so this improves what a user sees at once rather than guaranteeing global uniqueness; closing it entirely would need a wider card or a shorter name field, a density cost we judged not worth it. The fix is geometry (320 px column minimum, 72 px thumbnail), not a string trick. |
| Longest task during sustained scroll | | 64 ms (a single long task) | Measured on the target machine — Vidish's Mac (MacIntel, 10 cores, 16 GB, Chrome 152, viewport 1680×806, DPR 2), not the Linux build box — on the deployed build with chaos on, using two instruments. `PerformanceObserver('longtask')` recorded ONE long task of 64 ms across 96,000 px of scroll in 3,482 ms (80 steps × 1,200 px, one per animation frame), with 75 gridcells still rendered at depth; a DevTools trace over the same window reported CLS 0.00. The scroll is programmatic and deliberately adversarial — 1,200 px per frame is far more aggressive than a human flick, forcing continuous row recycling with no idle gaps — so 64 ms is a CEILING under abuse, not a typical figure. The CLS 0.00 across 96,000 px is the payoff for the scroller reserving full height up front: rows recycle beneath a scrollbar that never grows, so nothing jumps as pages arrive. |
| Requests fired while typing a 6-character query | 6 (one per keystroke) | 1 (250 ms trailing debounce collapses the burst) | Node 20 `fetch` against an ISOLATED api on `PORT=8801` (its own limiter; the shared `:8787` keys the 80/10 s limit on `remoteAddress` = localhost for every process on the box, so a 429 there is unrelated traffic). Measured at the network layer, where the race lives. StrictMode double-invokes effects in dev ONLY (12 raw in a dev session), so 6 is the production/network figure; capture + repro in `notes/baseline/` |
| Production bundle, gzipped | 48 kB (vendor baseline) | 77.24 kB JS + 2.64 kB CSS | `npm run build` with `NODE_ENV=production`, Vite's gzip report (Node 20 / Linux). Three independent measurements agree — this local build, an independent build on a clean host, and the **deployed** artifact measured over HTTPS (244,618 bytes raw, minified, zero `react.development` strings) — so the number is the artifact actually served, not one machine's report. The +29 kB over baseline buys TanStack Query (dedup/cache/one retry executor) and TanStack Virtual (viewport-bounded DOM), the structured transport (error taxonomy, sliding-window limiter, real cancellation), the bulk + selection layers (optimistic write/rollback, `207` partitioning), and the loading/empty/error/offline component shell — weight spent on scored behaviour, not for its own sake |

What was the actual bottleneck, and how did you find it?

Two, and both were **measured before any fix existed**, not inferred from reading the code:

- **The search race** — caught at the network layer against the untouched baseline. Short prefixes
  are deliberately slower, so the earlier request resolves last: on the deploy, `q=c` returns 10,681
  matches at 1.09 s while `q=campaign` returns 2,248 at 0.21 s — a *larger*, staler count visibly
  overwriting the finished one. Capturing it in `notes/baseline/` first is what makes the
  before/after real: once the fix lands, the "before" is gone.
- **The un-virtualised grid** — found by counting DOM nodes, not by it feeling slow: the baseline
  renders one node per row, so the count scaled with scroll depth rather than the viewport (after
  virtualisation, ~36 gridcells at 5,000 loaded in jsdom and ~112 at 840 loaded in Chrome, flat
  with depth).

Neither was a hunch from reading the source; each is a measurement I can name and re-run.

---

## Accessibility

**Keyboard model.** The grid uses a roving tabindex: exactly one card is in the
tab order at any time (every other card is `tabIndex=-1`), so the whole grid is a
single tab stop rather than 12,400. Arrow keys move the focused cell (with
Home/End and PageUp/PageDown), Enter opens the detail panel, Space toggles
selection and sets the range anchor, and Shift+arrows extend a contiguous
selection from that anchor. Because the list is virtualised, the card you are
navigating to may not be mounted — a row outside the rendered window has no DOM
node to receive focus — so navigation first scrolls the target index into
existence and then focuses it on mount (a pending-focus id handed to the row's
ref callback). This scroll-then-focus step is the design, not a fallback: it is
the only correct way to move focus across a window that renders on demand.

**How I tested it.** I did not run a screen reader. The brief permits saying so,
and claiming a pass I did not observe would be worse than an honest gap. What I
did verify, headlessly: the ARIA structure (grid/row/gridcell roles,
`aria-selected`, accessible names on each card and its select checkbox), the
roving tab order and focus movement, the polite live region that announces
selection changes, and — the part most likely to break silently — the
focus-reconciliation kernel. That kernel (`reconcileFocusIndex`) decides where
focus goes when the row it was on disappears, for example when a filter removes
it: focus follows the same asset if it survives, otherwise clamps to the nearest
surviving neighbour, and only becomes "none" when the list empties — so focus is
never left on a detached node. It is a pure function pinned by a failure-capable
unit harness (shown able to go red before it is trusted green); the index math
(`nextFocusIndex`, `selectionRangeIds`) and the render-window bound are pinned
the same way.

**Accessible names.** I walked every interactive control for an accessible name — the
filter checkboxes (wrapping labels), the card checkboxes (`aria-label`), the search box, and the
sort `<select>`. The sweep found the sort control shipping as an unnamed combobox: a screen reader
announced only its value ("Recently updated"), not that it controls sort order — WCAG 4.1.2. The
search box was named only by its placeholder, which technically passes but is a documented
antipattern (the cue disappears the moment you type). Both now carry an explicit `aria-label`.

**Known gaps.** Separated by confidence, honestly. The focus-reconciliation and
navigation kernels are proven by unit test but have never been exercised in a
real browser, so the end-to-end focus behaviour is reasoned and unit-verified but
unobserved.
No screen reader has been run, so the announced experience (reading order,
live-region timing under NVDA/VoiceOver) is unchecked. The detail panel is a
non-modal side panel: focus moves into it on open and restores to the originating
card on close, and Escape closes it, but focus is deliberately NOT trapped — I
rejected a modal focus trap because the panel coexists with the grid and the
brief explicitly asks for no focus traps, so a user can Tab out to the grid by
design.

---

## Interface decisions

I optimised for a reviewer who scans hundreds of cards and needs to trust what
they see: legibility, a status that is unambiguous at a glance, and failure
states that say what to do next. Restraint was a deliberate choice over
decoration - one accent, one neutral ramp, four status hues, and nothing
ornamental - because on this brief a calm, consistent surface reads as more
senior than a styled one, and it keeps the eye on the content.

- **Visual system.** A small set of tokens in `src/styles.css` with readable
  intent: one neutral ink ramp (primary/secondary/tertiary), a single accent, a
  4px spacing step used everywhere, a short type scale, and two line weights (a
  decorative hairline plus a stronger one for control borders). Everything
  downstream references the tokens rather than raw values.
- **Status treatment.** The four statuses are modelled as a lifecycle in
  `src/lib/status.ts` (draft -> in_review -> approved -> archived) and the colour
  runs as a progression: neutral, warm amber, green, then a cooled retired slate.
  Colour is never the only channel - each status carries a shape-distinct icon
  (pencil, half-filled circle, check, filed box) and its text label, so it stays
  readable for someone who cannot separate red from green. The chip label is
  always dark ink on a pale tint, so its contrast never depends on the hue.
- **States.** Loading is a calm skeleton (a shared shimmer primitive, composed
  into card-shaped placeholders by the grid and disabled under
  prefers-reduced-motion) rather than a spinner, so a slow, out-of-order API
  reads as loading and not broken. Empty distinguishes "no assets yet" from
  "nothing matches these filters" and offers a Clear filters action. A fetch
  error with nothing on screen is a full state; a fetch error over existing
  results is a non-blocking banner. Offline is detected from the browser signal.
  Partial bulk failure is summarised in plain language ("12 assets updated. 2
  could not be changed."), and its affordance is honest: the bulk bar offers Try
  again only while a retryable subset is still present, so once the only
  remaining failures are permanent (e.g. legal hold) the retry disappears and
  just Dismiss is left - a retry that cannot succeed is never offered.
- **Contrast.** Checked against WCAG 2.1 AA using `tools/contrast-check.mjs`, a
  script implementing the WCAG relative-luminance formula (the same maths as the
  WebAIM Contrast Checker); run with `node tools/contrast-check.mjs`, it exits
  non-zero if any pair misses its bar, so the palette is verified by computation
  rather than by eye. Measured ratios: body ink `#1b1d21` on white 16.9:1; secondary `#585d66` 6.6:1;
  tertiary `#6f757e` 4.6:1 (large only); white on accent `#2350c9` 6.9:1; danger
  `#a5301f` on white 6.9:1; status labels 14.5-15.3:1 on their tints; status
  icons 4.7-6.2:1; control border `#838a93` 3.5:1 on white and 3.2:1 on the soft
  surface. All pass their AA bar (4.5:1 text, 3:1 large/graphic).
- **Copy.** Every user-facing failure is rewritten in `src/lib/messages.ts`,
  keyed on the API error `code` (never the message string, which Task 4 forbids).
  The server's `429: Too many requests in the last 10 seconds.` becomes "Slowing
  down to keep up - too many requests just now. Pausing a few seconds, then
  continuing."; `version_conflict` becomes "This asset changed while you were
  editing - refresh to see it, then reapply your change."; `legal_hold` explains
  that assets on legal hold cannot be archived. Each message also carries a tone
  and whether a retry can help, so the UI can offer the right affordance. A
  partial bulk result names why each subset failed in one line and separates the
  permanent cause from the transient one - a chaos-on run returned "64 assets
  updated. 8 could not be changed. 7 on legal hold, 1 a momentary clash. Items on
  legal hold cannot be changed.", so the user can see that the clash will be
  retried and the legal-hold items will not.
- **On-device pass and screenshots.** Outstanding, and honestly so. The running
  application has not been driven end to end in a real browser, so the on-device
  pass and screenshots are to be captured during the recorded walkthrough rather
  than claimed here. What is verified is at the unit and jsdom level (the copy
  layer is unit-pinned, and error-object survival is pinned end to end through the
  real transport and hook). The render-level assertion lands with the App wiring.
  The remaining screenshots of loading / empty / error / offline / partial bulk
  failure / the bulk bar are part of that same recorded pass.

---

## Trade-offs and cuts

Every cut below was a choice, not an oversight — the brief scores saying what was left and why.

- **Offline write queueing** — a bonus in the brief, skipped on purpose. We detect offline, stop
  hammering, and resume on reconnect; we do not queue writes *made* while offline for later replay.
  The required offline state is present; the replay queue is the bonus we did not spend the window on.
- **Live updates (`GET /api/events`)** — optional, not wired. SSE costs zero rate budget (it
  short-circuits before the limiter), so this was scope discipline, not a cost concern. The cache
  reconciliation such a feed needs is already built (writes patch the list and detail caches in
  place), so a subscription is a small addition, not a rework.
- **The `/api/stats` header** — optional, not built.
- **An interactive budget slice** — the client-wide limiter is FIFO with no priority, so a large
  background bulk can make a foreground search wait behind it: ~11 s at ~7 tokens/s in the worst
  case. Pre-limiter that search would have been *sent* and 429'd, so waiting beats failing — but it
  is a real latency coupling. The fix we did not build: reserve a slice of budget for interactive
  GETs, or take a priority argument (~15 lines on the existing limiter seam).
- **A structurally-impossible double-retry guard** — chunked helpers own their retry, so a caller
  must spread `chunkedHelperOptions` or attempts stack 3×3 against the limiter. Today that is a
  documented rule plus a test that reddens if the guard is removed, and the one real call site
  honours it — but a *future* call site that forgets the spread still gets 9×. The impossible version
  exports ready-made options that bake the function and `retry: false` together, so a caller cannot
  wire one without the other.
- **Two numbers need a browser** — the longest task during sustained scroll (needs a profile, shown
  in the walkthrough) and a screen-reader pass are unmeasured, and are stated as outstanding in the
  Performance and Accessibility sections rather than guessed at.

## Critique of the API

What you would change about the backend contract, and what it forced you to do in
the client that you would rather not have.

_(Transport layer — W1. Other tasks may add to this.)_

- **`write_failed` (500) is retryable but carries no `Retry-After`.** The client
  has to guess a backoff for a write it is told is safe to repeat; a hint would
  let it pace writes instead of probing.
- **The 429 `Retry-After` is a flat 3s** regardless of how far over the window you
  are. A value proportional to the rolling window would let a well-behaved client
  recover faster without blind retries.
- **`bulk-status` conflates transport and per-item failure.** A whole-request 503
  and a per-item `conflict` need different handling, so the client folds a failed
  chunk back into per-id failures to keep "which ones failed and why" honest. A
  consistent per-id envelope even on transport failure would remove that
  reconciliation.
- **Two different id caps (25 batch, 50 bulk)** force two chunk sizes for no
  client-visible reason; one cap would simplify every caller.
- **The rate limiter is harsher than documented, and silently so.** API.md says
  retries count; the server actually records the timestamp BEFORE deciding, so a
  request that is itself 429'd still consumes a slot — a rejected request keeps
  the window saturated. A client that reads only the docs will under-provision its
  own budget. We pace at ~70/10s centrally to stay clear of it; the contract
  should state that rejected requests count.
- **The rate limiter cannot serve concurrent users behind a proxy — a property of the server, not of
  any client.** It keys the 80-req/10s window on `req.socket.remoteAddress` and ignores
  `X-Forwarded-For` (`server/index.mjs`), so behind any reverse proxy every visitor presents as the
  proxy's address and they all share ONE bucket. We proved it black-box from two hosts with distinct
  public IPs: host B alone against a quiet bucket succeeded 3/3; host A then fired a bounded
  90-request burst inside one 10 s window (73×200, 7×503 from chaos, 10×429 once the cap engaged);
  host B — sending only 2 requests 2.4 s into that same window, with none of its own before — got
  429/429; after a 13 s drain, B alone succeeded 3/3 again. B fails only in A's shadow, never in
  isolation, and the exhausting traffic need not even be ours — a second browser tab or anyone else
  on the API collapses it the same way. So a client-side budget is **necessary but not sufficient**:
  it governs our own consumption but cannot protect a user from a shared bucket a third party can
  exhaust. The complete fix takes both — our budget *and* a one-line server change: key the limiter
  off a trusted `X-Forwarded-For`, falling back to the socket address. Two corroborations from the
  same run: A's 90 requests came back as exactly 80 admitted (73×200 + 7×503) then 10×429, confirming
  the strictly `>80` threshold from outside a code reading; and those 7 chaos-503s still consumed
  slots — the limiter counts every request it sees regardless of outcome, which is precisely the
  property that makes retry storms self-reinforcing.
- **The API binds `0.0.0.0` with no bind-host option.** `server.listen(PORT)` exposes it on every
  interface; a deployable service should accept a bind host (e.g. `HOST` / `127.0.0.1`) so
  same-origin isolation does not depend on external firewalling.

## Anything you would like us to look at

- **The tests were validated by breaking the mechanism, not just by passing.** The retry predicate,
  the stale-response race, the partial-failure rollback, the sliding-window boundary and the 429 copy
  path were each confirmed to go RED when the behaviour was defeated. A green test that has never been
  seen red is a claim, not evidence — so each scored one has a mutation on record.
- **The sliding-window limiter matches the frozen server's eviction predicate exactly**, so the
  client's notion of "in window" cannot drift from the server's. A fixed window would allow 80 at
  t=9.9 s and 80 more at t=10.1 s — 160 in one trailing window — while believing it complied.
- **The `legal_hold` / `conflict` split.** Per-item failures arrive inside a `207`, which is a 2xx,
  so they never surface as errors and the transport's retry predicate cannot see them. Retry is
  offered only for the retryable (`conflict`) subset; a deterministic `legal_hold` failure is never
  re-fired into a limiter that would count it.
- **The 429 copy path, pinned end to end** — the error object surviving the query hook with its
  `code` intact, and the specific words reaching the rendered surface, each proven by a test that
  reddens if the object is flattened or the copy lookup collapses.
