import { z } from 'zod';

// ============================================================================
// Bulk student import.
//
// Forgiving by rule: the file is previewed before anything is written, errors
// are reported against their line number, and a commit applies ONLY the valid
// rows rather than refusing the whole file over one bad number.
// ============================================================================

/** What a single line would do. `skip` means it has errors and will be left. */
export const studentImportActionSchema = z.enum(['create', 'update', 'skip']);
export type StudentImportAction = z.infer<typeof studentImportActionSchema>;

export const studentImportRowSchema = z.object({
  /** 1-based line in the uploaded file, header included, as an editor shows it. */
  line: z.number().int(),
  mobile: z.string().nullable(),
  fullName: z.string().nullable(),
  groupNames: z.array(z.string()),
  groupIds: z.array(z.string()),
  /** Set when the number already belongs to a student — this row updates them. */
  existingStudentId: z.string().nullable(),
  action: studentImportActionSchema,
  errors: z.array(z.string()),
});
export type StudentImportRow = z.infer<typeof studentImportRowSchema>;

export const studentImportSummarySchema = z.object({
  total: z.number().int(),
  willCreate: z.number().int(),
  willUpdate: z.number().int(),
  invalid: z.number().int(),
});
export type StudentImportSummary = z.infer<typeof studentImportSummarySchema>;

export const studentImportPlanSchema = z.object({
  rows: z.array(studentImportRowSchema),
  summary: studentImportSummarySchema,
  /** Wrong with the FILE rather than a row — a missing column, an empty upload. */
  fileErrors: z.array(z.string()),
});
export type StudentImportPlan = z.infer<typeof studentImportPlanSchema>;

/** The result of actually applying the plan. */
export const studentImportResultSchema = studentImportSummarySchema.extend({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
});
export type StudentImportResult = z.infer<typeof studentImportResultSchema>;

export const IMPORT_ROUTES = {
  studentsPreview: '/imports/students/preview',
  studentsCommit: '/imports/students/commit',
  /** The sample workbook, generated from STUDENT_IMPORT_COLUMNS below. */
  studentsTemplate: '/imports/students/template',
} as const;

/** What the sample file is called when it lands in the admin's downloads. */
export const STUDENT_IMPORT_TEMPLATE_FILENAME = 'iace-students-template.xlsx';

/** The multipart field the upload arrives under. Server and client must agree. */
export const IMPORT_FILE_FIELD = 'file';

/** What the upload control accepts, and what the server will read. */
export const IMPORT_ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'] as const;

/**
 * The columns, in order — the ONE definition of the format.
 *
 * The sample workbook is generated from this and the parser matches on it, so
 * the file an admin downloads cannot document a format the importer will not
 * accept. A hand-written sample drifts the first time a column is renamed, and
 * takes everyone who already downloaded it with it.
 */
export const STUDENT_IMPORT_COLUMNS = [
  { header: 'mobile', width: 16, required: true },
  { header: 'fullName', width: 28, required: false },
  { header: 'groups', width: 52, required: false },
] as const;
