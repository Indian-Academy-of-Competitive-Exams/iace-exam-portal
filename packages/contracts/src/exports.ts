import { z } from 'zod';
import { ErrorCodes } from './envelope';
import { type ReportKey } from './reports';
import { todayISO } from './students';

/** Where an asked-for file stands: a worker builds it, so the asker waits on this, not on the request. */
export const EXPORT_JOB_STATES = { RUNNING: 'running', DONE: 'done', FAILED: 'failed' } as const;

export const exportStartedSchema = z.object({ id: z.string() });
export type ExportStarted = z.infer<typeof exportStartedSchema>;

export const exportJobSchema = z.object({
  id: z.string(),
  state: z.enum(EXPORT_JOB_STATES),
  error: z.object({ code: z.enum(ErrorCodes), message: z.string() }).nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const ADMIN_EXPORT_ROUTES = {
  job: (id: string) => `/admin/exports/${id}`,
  file: (id: string) => `/admin/exports/${id}/file`,
} as const;

/** How often the asker looks, and how long before it stops looking; the file outlives neither by much. */
export const EXPORT_POLL_MS = 1_500;
export const EXPORT_WAIT_MS = 10 * 60 * 1_000;

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
/** A report downloads under its own key, so ten of them do not land as ten files of one name. */
export type ExportKind = (typeof EXPORT_KINDS)[keyof typeof EXPORT_KINDS] | ReportKey;

export function exportFilename(kind: ExportKind): string {
  return `${kind}-${todayISO()}.xlsx`;
}
