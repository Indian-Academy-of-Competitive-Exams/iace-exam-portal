/** The four absences a region can have. The glyph says which one before a word is read. */
export const EMPTY_STATE_KINDS = {
  EMPTY: 'EMPTY',
  FILTERED: 'FILTERED',
  FAILURE: 'FAILURE',
  REFUSED: 'REFUSED',
} as const;
export type EmptyStateKind = (typeof EMPTY_STATE_KINDS)[keyof typeof EMPTY_STATE_KINDS];
