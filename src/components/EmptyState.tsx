import { StateBlock } from './StateBlock';

/**
 * The whole-view, successful zero-row state. Distinct from an error: the query
 * worked, nothing matched. Offers a way forward when a filter is narrowing the
 * results (the shell passes onClearFilters when a filter is active).
 */
export function EmptyState({ onClearFilters }: { onClearFilters?: () => void }) {
  return (
    <StateBlock
      variant="empty"
      title="Nothing matches these filters"
      body="Try a broader search, or clear a filter to see more."
      action={
        onClearFilters ? (
          <button className="btn-subtle" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : undefined
      }
    />
  );
}
