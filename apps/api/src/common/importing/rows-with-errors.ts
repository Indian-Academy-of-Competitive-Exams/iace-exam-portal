import { type Response } from 'express';
import { AppException, EXPORT_KINDS, ErrorCodes } from '@iace/contracts';
import { sendWorkbook, writeWorkbook, type ExportSheet } from '../exporting';
import { normaliseHeader, type CsvRow, type CsvTable } from './csv';

const ERRORS_HEADER = 'Errors';
const CELL_WIDTH = 20;
const ERRORS_WIDTH = 60;

/** The lines an import refused, as the file had them, each with why — fix it and upload it again. */
export function rowsWithErrors(
  table: CsvTable,
  errorsByLine: ReadonlyMap<number, readonly string[]>,
): ExportSheet<CsvRow> {
  // A re-downloaded download already carries an Errors column; the new one replaces it.
  const errorsKey = normaliseHeader(ERRORS_HEADER);
  const cells = table.headers.flatMap((key, index) =>
    key === errorsKey ? [] : [{ key, header: table.labels?.[index] ?? key }],
  );

  return {
    name: ERRORS_HEADER,
    columns: [
      ...cells.map(({ key, header }) => ({
        header,
        width: CELL_WIDTH,
        text: true as const,
        value: (row: CsvRow) => row.values[key] ?? '',
      })),
      {
        header: ERRORS_HEADER,
        width: ERRORS_WIDTH,
        value: (row: CsvRow) => errorsByLine.get(row.line)?.join('; ') ?? '',
      },
    ],
    rows: table.rows.filter((row) => (errorsByLine.get(row.line)?.length ?? 0) > 0),
  };
}

/** A file the preview could not plan has no rows to hand back; say what the preview said. */
export function refuseFileErrors(fileErrors: readonly string[]): void {
  if (fileErrors.length > 0) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, fileErrors.join(' '));
  }
}

export async function sendErrorRows(response: Response, sheet: ExportSheet): Promise<void> {
  sendWorkbook(response, EXPORT_KINDS.IMPORT_ERRORS, await writeWorkbook([sheet]));
}
