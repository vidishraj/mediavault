# Pending test drafts

Two hook tests, written now but not yet active, per the sequencing decision: draft while the
thinking is fresh, but do NOT touch `package.json` while the transport foundation is closing majors
on `main` — the lockfile is the real merge hazard, not the manifest. They live here (outside `src`,
and with a `.pending` suffix so neither `tsc` nor `vitest` picks them up) until they can run.

## Why these two specifically

The **250 ms debounce** and the **URL replace-vs-push split** are scored answers in `SUBMISSION.md`.
Right now each is a claim with a stated justification and no test — an asserted property nothing can
falsify. These close that gap, and each carries a MUTATION CHECK so it is proven non-vacuous:
defeating the behaviour must turn the test red.

- `useDebouncedValue.test.tsx.pending` — a burst of keystrokes collapses to one settled value.
  Mutation: delay → 0 must redden it. (Backs the measured "6 requests → 1".)
- `useUrlAssetQuery.history.test.tsx.pending` — typing replaces, a committed filter change pushes,
  and the query restores from the URL on mount. Mutation: make `setSearch` push must redden it.

## Activate (after the transport foundation lands on `main` and I have merged it)

1. `git mv notes/drafts/useDebouncedValue.test.tsx.pending src/features/assets/useDebouncedValue.test.tsx`
2. `git mv notes/drafts/useUrlAssetQuery.history.test.tsx.pending src/features/assets/useUrlAssetQuery.history.test.tsx`
3. Add dev deps only: `NODE_ENV=development npm install --include=dev --save-dev @testing-library/react jsdom`
4. `npx vitest run` — both green. Then run each mutation check once, confirm red, revert.

`@testing-library/react` and `jsdom` are **dev** dependencies — they do not ship, so the gzipped
production bundle (a scored number) is unaffected. State that in `SUBMISSION.md` next to the tests so
nobody reads a bundle change into them.
