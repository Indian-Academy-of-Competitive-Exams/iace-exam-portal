import { AppException, EXPORT_MAX_ROWS, ErrorCodes } from '@iace/contracts';

/** Called with the count before any row is read, so an oversized export costs one query. */
export function assertExportable(count: number): void {
  if (count <= EXPORT_MAX_ROWS) return;
  throw new AppException(
    ErrorCodes.EXPORT_TOO_LARGE,
    `That is ${count.toLocaleString('en-IN')} rows, and one file holds at most ${EXPORT_MAX_ROWS.toLocaleString('en-IN')}. Narrow the filters and try again.`,
  );
}
