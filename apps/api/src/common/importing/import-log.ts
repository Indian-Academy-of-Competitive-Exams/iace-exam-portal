import { XLSX_CONTENT_TYPE } from '@iace/contracts';
import { looksLikeWorkbook } from './sheet-reader';

const CSV_EXTENSION = 'csv';

/** Where an uploaded sheet is kept, so a commit can re-read exactly what was previewed; the extension follows the bytes, because a roster may have arrived as a CSV. */
export const importFileKey = (feature: string, id: string, file?: Buffer): string =>
  `imports/${feature.toLowerCase()}/${id}.${
    file && !looksLikeWorkbook(file) ? CSV_EXTENSION : 'xlsx'
  }`;

/** What the stored bytes are, read back off the key, so a download's name and its type agree. */
export const importFileContentType = (key: string): string =>
  key.endsWith(`.${CSV_EXTENSION}`) ? 'text/csv' : XLSX_CONTENT_TYPE;
