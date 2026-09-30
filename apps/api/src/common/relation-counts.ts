/**
 * A page's own relation counts. Prisma's `_count` in an `include` joins an UNGROUPED aggregate —
 * `GROUP BY` over the whole child table — so a list of ten tests counts every attempt ever sat.
 * A `groupBy` restricted to the ids on the page is the same answer off an index.
 */

/** A `groupBy({ by: [key], _count: true })` result as a lookup; a row the group never saw reads zero. */
export function countsBy<K extends string>(
  rows: readonly (Record<K, string | null> & { _count: number })[],
  key: K,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = row[key];
    if (id !== null) counts.set(id, row._count);
  }
  return counts;
}
