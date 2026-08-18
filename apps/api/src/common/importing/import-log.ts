/**
 * The status column of an `ImportLog` run. A plain string in the schema, so the
 * values live here rather than in an enum nobody can find.
 */
export const IMPORT_LOG_STATUS = {
  /** The file is stored and planned; nothing has been written yet. */
  PREVIEWED: 'PREVIEWED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
} as const;

export type ImportLogStatus = (typeof IMPORT_LOG_STATUS)[keyof typeof IMPORT_LOG_STATUS];

/** Where an uploaded sheet is kept, so a commit can re-read exactly what was previewed. */
export const importFileKey = (feature: string, id: string, extension = 'xlsx'): string =>
  `imports/${feature.toLowerCase()}/${id}.${extension}`;
