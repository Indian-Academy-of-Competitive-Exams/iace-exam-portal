/** Where an uploaded sheet is kept, so a commit can re-read exactly what was previewed. */
export const importFileKey = (feature: string, id: string, extension = 'xlsx'): string =>
  `imports/${feature.toLowerCase()}/${id}.${extension}`;
