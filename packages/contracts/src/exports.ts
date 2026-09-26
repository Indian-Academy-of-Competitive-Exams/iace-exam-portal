import { todayISO } from './students';

/** The most rows one export writes; counted before any row is read. */
export const EXPORT_MAX_ROWS = 50_000;

/** Every file an admin can download; the kind is the filename's stem. */
export const EXPORT_KINDS = {
  TEST_REPORT: 'test-report',
  STUDENTS: 'students',
  STUDENT_PERFORMANCE: 'student-performance',
  QUESTIONS: 'questions',
  AUDIT_LOG: 'audit-log',
  ANNOUNCEMENT_DELIVERIES: 'announcement-deliveries',
  SERIES_GRANTS: 'series-grants',
  IMPORT_ERRORS: 'import-errors',
} as const;
export type ExportKind = (typeof EXPORT_KINDS)[keyof typeof EXPORT_KINDS];

export function exportFilename(kind: ExportKind): string {
  return `${kind}-${todayISO()}.xlsx`;
}
