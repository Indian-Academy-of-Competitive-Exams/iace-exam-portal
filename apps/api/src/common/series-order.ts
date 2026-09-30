/** An unpositioned test sorts last, and the id keeps the order stable when two share a position. */
const ORDERED_LAST = Number.MAX_SAFE_INTEGER;

/** One order for the whole platform: the student catalog sorts a series' tests this way, and the Offer step judges an opening against the same sequence. */
export function byOrderThenId(
  left: { id: string; order: number | null },
  right: { id: string; order: number | null },
): number {
  return (
    (left.order ?? ORDERED_LAST) - (right.order ?? ORDERED_LAST) || left.id.localeCompare(right.id)
  );
}
