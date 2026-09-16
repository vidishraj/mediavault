/**
 * The shared loading primitive: a calm shimmer box (disabled under
 * prefers-reduced-motion, handled in CSS). The first-page and in-scroller
 * skeleton compositions are owned by the grid so real rows replace skeleton
 * rows with no layout shift; this primitive is the building block they reuse.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className ?? ''}`} aria-hidden="true" />;
}
