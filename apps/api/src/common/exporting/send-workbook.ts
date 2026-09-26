import { type Response } from 'express';
import { XLSX_CONTENT_TYPE, exportFilename, type ExportKind } from '@iace/contracts';

/** Streamed, never a signed link: an export is full of student PII. */
export function sendWorkbook(response: Response, kind: ExportKind, workbook: Buffer): void {
  response.setHeader('Content-Type', XLSX_CONTENT_TYPE);
  response.setHeader('Content-Disposition', `attachment; filename="${exportFilename(kind)}"`);
  response.setHeader('Cache-Control', 'no-store');
  response.send(workbook);
}
