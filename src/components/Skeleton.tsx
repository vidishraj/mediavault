/**
 * Loading placeholders. A calm shimmer that mirrors the real card layout, so a
 * slow or out-of-order API reads as "loading" rather than "empty" or "broken".
 * The shimmer is disabled under prefers-reduced-motion (handled in CSS).
 */

export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ''}`} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className="card" aria-hidden="true">
      <Skeleton className="card__thumb" />
      <div className="card__body">
        <Skeleton className="skel-line skel-line--name" />
        <Skeleton className="skel-line skel-line--meta" />
      </div>
    </div>
  );
}

/** A grid of card skeletons for the first load. */
export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-label="Loading assets">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
