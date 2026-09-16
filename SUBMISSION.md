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

## Time spent

Roughly, and how you split it.

---

## Baseline defects found

| # | Defect | Where | Fixed / left / out of scope |
| --- | --- | --- | --- |
| 1 | Bulk update sends >50 ids in one call | `App.tsx` | Chunked at the cap in the transport (W1) |
| 2 | Stale search response overwrites a newer query (no cancel; applies last-resolved) | `useAssets.ts`, `client.ts` | Fixed — query-keyed fetch + AbortSignal |
| 3 | Every keystroke fires a request; nothing debounced (trips 80/10 s) | `App.tsx`, `useAssets.ts` | Fixed — 250 ms trailing debounce |
| 4 | Loading, empty and error conflated (stale rows under a banner; failed first load reads as empty) | `useAssets.ts`, `AssetGrid.tsx` | Fixed — three distinct states |
| 5 | Query state not in the URL; reload/share loses the view | `App.tsx` | Fixed — URL-backed q/status/kind/tag/sort |
| 6 | Changing a filter can reuse a cursor from the old query (`400 stale_cursor`) | `App.tsx` | Fixed — cursor excluded from the key, unreachable |

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
bundle — a scored number — is unaffected by it. Relatedly, any advisory `npm audit` surfaces is
in dev tooling only: `npm audit --omit=dev` reports **zero**, so nothing in them reaches the
production bundle.

**Virtualization approach**

**Optimistic updates and rollback**

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
in one trailing window, while believing it complied).

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
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | 6 (one per keystroke) | 1 (250 ms trailing debounce collapses the burst) | Node 20 `fetch` against an ISOLATED api on `PORT=8801` (its own limiter; the shared `:8787` keys the 80/10 s limit on `remoteAddress` = localhost for every crew member, so a 429 there is someone else's traffic). Measured at the network layer, where the race lives. StrictMode double-invokes effects in dev ONLY (12 raw in a dev session), so 6 is the production/network figure; capture + repro in `notes/baseline/` |
| Production bundle, gzipped | 48 kB | 58.5 kB | `NODE_ENV=production npm run build`, Vite's gzip report (Node 20, Linux). +10.5 kB is TanStack Query, replacing hand-rolled dedup/cache/retry |

What was the actual bottleneck, and how did you find it?

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

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
- **States.** Loading is a calm skeleton that mirrors the card layout (disabled
  under prefers-reduced-motion) rather than a spinner, so a slow, out-of-order
  API reads as loading and not broken. Empty distinguishes "no assets yet" from
  "nothing matches these filters" and offers a Clear filters action. A fetch
  error with nothing on screen is a full state; a fetch error over existing
  results is a non-blocking banner. Offline is detected from the browser signal.
  Partial bulk failure is summarised in plain language ("12 assets updated. 2
  could not be changed.").
- **Contrast.** Checked against WCAG 2.1 AA using `tools/contrast-check.mjs`, a
  script implementing the WCAG relative-luminance formula (the same maths as the
  WebAIM Contrast Checker); it fails the build if any pair misses its bar.
  Measured ratios: body ink `#1b1d21` on white 16.9:1; secondary `#585d66` 6.6:1;
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
  and whether a retry can help, so the UI can offer the right affordance.
- **Screenshots.** Link forthcoming, captured from the running app once the
  integrated UI is deployed; the states worth seeing are loading, empty, error,
  offline, partial bulk failure and the bulk action bar, not just the happy path.

---

## Trade-offs and cuts

What you deliberately did not do, and what you would do with another day.

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

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
