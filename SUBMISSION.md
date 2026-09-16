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
| 1 | Bulk update sends >50 ids in one call | `App.tsx` | |
| 2 | | | |

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

**Stale response handling**

**Virtualization approach**

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
a bulk action recovers those ~7%. Membership nuance (an optimistic status change
can make an item stop matching a filtered list): left to reconcile on refetch
rather than pruned, because pruning would fight row keying, focus and scroll.

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

**State placement and URL sync**

---

## Performance

Fill in real measurements, not estimates. Say which machine and browser.

| Metric | Before | After | How measured |
| --- | --- | --- | --- |
| Rendered DOM nodes at 5,000 rows loaded | | | |
| Cards re-rendered when toggling one selection | | | |
| Longest task during sustained scroll | | | |
| Requests fired while typing a 6-character query | | | |
| Production bundle, gzipped | 48 kB | 58.5 kB | `NODE_ENV=production npm run build`, Vite's gzip report (Node 20, Linux). +10.5 kB is TanStack Query, replacing hand-rolled dedup/cache/retry |

What was the actual bottleneck, and how did you find it?

---

## Accessibility

- Keyboard model you implemented, in one paragraph.
- How you tested it, including any screen reader.
- Known gaps.

---

## Interface decisions

Three or four sentences: what you were optimising for, and the decisions that
follow from it. Then briefly:

- **Visual system.** Your colour, spacing and type decisions, and where they live.
- **Status treatment.** How the four statuses read as a progression, and how they
  stay distinguishable without relying on colour.
- **States.** What you did with loading, empty, error, offline and partial
  failure.
- **Contrast.** What you checked against, and with what.
- **Copy.** Any user-facing message you rewrote and why.

Screenshots in the repo are welcome — link them here.

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
