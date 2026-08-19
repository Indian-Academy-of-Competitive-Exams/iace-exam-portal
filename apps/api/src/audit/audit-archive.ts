import { gzipSync } from 'node:zlib';
import { AppException, ErrorCodes } from '@iace/contracts';

/** 30 days hot in Postgres; everything older lives in S3. */
export const AUDIT_RETENTION_DAYS = 30;

export const AUDIT_ARCHIVE_PREFIX = 'audit/row-actions';

export function archiveKeyFor(day: Date): string {
  const year = day.getUTCFullYear();
  const month = String(day.getUTCMonth() + 1).padStart(2, '0');
  const date = String(day.getUTCDate()).padStart(2, '0');
  return `${AUDIT_ARCHIVE_PREFIX}/${year}/${month}/${date}.ndjson.gz`;
}

/**
 * `JSON.stringify` escapes newlines, so one row is always exactly one line.
 * Trailing newline on non-empty input only; a reader should skip blank lines regardless.
 */
export function toNdjson(rows: readonly object[]): Buffer {
  if (rows.length === 0) return gzipSync('');
  return gzipSync(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

/** Midnight UTC of the day that has just fallen outside the window. Never today. */
export function dayToArchive(now: Date, retentionDays: number): Date {
  if (retentionDays < 1) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, 'retentionDays must be at least 1');
  }
  const boundary = new Date(now);
  boundary.setUTCDate(boundary.getUTCDate() - retentionDays);
  boundary.setUTCHours(0, 0, 0, 0);
  return boundary;
}
