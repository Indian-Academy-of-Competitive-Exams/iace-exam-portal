/** One search box over several columns, so a row is found by anything it SHOWS. */
export function everyTermMatches<T>(
  search: string | undefined,
  fieldsFor: (term: string) => T[],
): { AND?: { OR: T[] }[] } {
  const terms =
    search
      ?.trim()
      .split(/\s+/)
      .filter((term) => term !== '') ?? [];
  if (terms.length === 0) return {};
  // "SSC CGL Tier 1" is an exam code AND a stage name, so each word must land somewhere of its own.
  return { AND: terms.map((term) => ({ OR: fieldsFor(term) })) };
}
