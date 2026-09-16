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

**Optimistic updates and rollback**

**Retry and backoff policy** — A predicate over the taxonomy. RETRY:
`upstream_unavailable` (503), `rate_limited` (429), `write_failed` (500, marked
safe to retry in API.md), and network errors. NEVER: 400 (bad_request /
stale_cursor / …), 409 version_conflict, 422 (invalid_* / legal_hold), 404.
Backoff is exponential with FULL JITTER, a hard cap of 3 attempts, and honours a
server `Retry-After` as a floor. The rate limit (80 req/10s, retries count) is
the designed trap, so the policy is built NOT to amplify: capped attempts, jitter
so concurrent failures do not resynchronise into a second wave, and honouring the
3s `Retry-After` on a 429 instead of hammering. Rejected: matching on the message
(breaks on a reword), immediate/unbounded retry (turns one 503 into a storm), and
a proactive client-side token-bucket limiter — deferred, because the
capped+jittered backoff already prevents amplification for W1; a token bucket is
the next step only if 429s persist under real load.

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

## Anything you would like us to look at

Code you are proud of, or a decision you are unsure about and want to discuss.
