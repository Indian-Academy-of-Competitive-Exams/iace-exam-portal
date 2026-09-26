/** Only what was chosen: the log would otherwise carry every unset filter as a null. */
export function chosenFilters(query: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined));
}
