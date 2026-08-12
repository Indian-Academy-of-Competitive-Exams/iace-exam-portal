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

/** The CSV itself, as text. Sent to /imports, where the larger body limit lives. */
export const studentImportSchema = z.object({
  csv: z.string().min(1, 'Nothing to import'),
});
export type StudentImportInput = z.input<typeof studentImportSchema>;
export type StudentImportBody = z.infer<typeof studentImportSchema>;

export const IMPORT_ROUTES = {
  studentsPreview: '/imports/students/preview',
  studentsCommit: '/imports/students/commit',
} as const;

/** The header row an admin should start from. */
/**
 * Shown as the textarea's placeholder, so it doubles as the format's
 * documentation. The second row is the qualified form: a group name is unique
 * only within its branch, and writing the branch is how you say which one you
 * meant when two centres run the same batch.
 */
export const STUDENT_IMPORT_TEMPLATE = [
  'mobile,fullName,groups',
  '9876543210,Asha Kumari,SSC CGL MORNING',
  '9876543211,Ravi Teja,AMEERPET / SSC CGL MORNING;GLOBAL / ALL STUDENTS',
  '',
].join('\n');
