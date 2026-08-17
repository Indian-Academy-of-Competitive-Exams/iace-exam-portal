import { z } from 'zod';
import { groupRefSchema } from './students';

// ============================================================================
// Bulk student import. Previewed before anything is written, errors reported by
// line, and a commit applies only the valid rows.
// ============================================================================

/**
 * How a record got here. INDIVIDUAL is one admin filling a form, SHEET an
 * uploaded file, SCRIPT the main portal syncing, SELF_SIGNUP the student.
 */
export const IMPORT_SOURCE = {
  INDIVIDUAL: 'INDIVIDUAL',
  SHEET: 'SHEET',
  SCRIPT: 'SCRIPT',
  SELF_SIGNUP: 'SELF_SIGNUP',
} as const;
export const importSourceSchema = z.enum(IMPORT_SOURCE);
export type ImportSource = z.infer<typeof importSourceSchema>;

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
  /** Whether this row hands out a starting PIN. Never for a student who chose their own. */
  willReceiveDefaultPin: z.boolean(),
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

/** Bounded by argon2: every new student costs ~13ms of hashing, so a big roster would time out. */
export const IMPORT_MAX_ROWS = 1000;

/** The .xlsx media type. A typo here breaks the Content-Type and the file picker silently. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What the upload control accepts, and what the server will read. */
export const IMPORT_ACCEPTED_EXTENSIONS = ['.xlsx', '.csv'] as const;

/**
 * The columns, in order — the ONE definition of the format: the sample is generated
 * from this and the parser matches on it. `header` is what a person reads;
 * `aliases` is what the parser accepts, normalised, so an older template still imports.
 */
export const STUDENT_IMPORT_COLUMNS = [
  {
    key: 'mobile',
    header: 'Mobile Number',
    width: 18,
    required: true,
    aliases: [
      'mobilenumber',
      'mobile',
      'mobileno',
      'phonenumber',
      'phone',
      'phoneno',
      'contactnumber',
      'contact',
      'number',
    ],
  },
  {
    key: 'fullName',
    header: 'Full Name',
    width: 28,
    required: false,
    aliases: ['fullname', 'name', 'studentname', 'student'],
  },
  {
    key: 'groups',
    header: 'Groups',
    width: 52,
    required: false,
    aliases: ['groups', 'group', 'batch', 'batches', 'groupnames'],
  },
] as const;

export type StudentImportColumn = (typeof STUDENT_IMPORT_COLUMNS)[number];
export type StudentImportColumnKey = StudentImportColumn['key'];

// ============================================================================
// Adding students to ONE group, in bulk: a list of mobile numbers, with the group
// taken from the screen rather than a column. Add only — removing is a visible act.
// ============================================================================

/** The one column a membership sheet needs. */
export const GROUP_MEMBER_IMPORT_COLUMNS = [
  STUDENT_IMPORT_COLUMNS[0],
] as const satisfies readonly StudentImportColumn[];

export const GROUP_MEMBER_IMPORT_TEMPLATE_FILENAME = 'iace-group-members-template.xlsx';

/**
 * `add` — exists, not in the group. `already` — in it (not an error, re-uploading is
 * normal). `skip` — unreadable, repeated, or belongs to nobody.
 */
export const groupMemberImportActionSchema = z.enum(['add', 'already', 'skip']);
export type GroupMemberImportAction = z.infer<typeof groupMemberImportActionSchema>;

export const groupMemberImportRowSchema = z.object({
  line: z.number().int(),
  mobile: z.string().nullable(),
  /** The student that number resolves to, when it resolves to one. */
  studentId: z.string().nullable(),
  studentName: z.string().nullable(),
  action: groupMemberImportActionSchema,
  errors: z.array(z.string()),
});
export type GroupMemberImportRow = z.infer<typeof groupMemberImportRowSchema>;

export const groupMemberImportSummarySchema = z.object({
  total: z.number().int(),
  willAdd: z.number().int(),
  alreadyMembers: z.number().int(),
  invalid: z.number().int(),
});
export type GroupMemberImportSummary = z.infer<typeof groupMemberImportSummarySchema>;

export const groupMemberImportPlanSchema = z.object({
  group: groupRefSchema,
  rows: z.array(groupMemberImportRowSchema),
  summary: groupMemberImportSummarySchema,
  fileErrors: z.array(z.string()),
});
export type GroupMemberImportPlan = z.infer<typeof groupMemberImportPlanSchema>;

export const groupMemberImportResultSchema = groupMemberImportSummarySchema.extend({
  added: z.number().int(),
});
export type GroupMemberImportResult = z.infer<typeof groupMemberImportResultSchema>;

export const GROUP_IMPORT_ROUTES = {
  membersPreview: (groupId: string) => `/imports/groups/${groupId}/members/preview`,
  membersCommit: (groupId: string) => `/imports/groups/${groupId}/members/commit`,
  membersTemplate: '/imports/groups/members/template',
} as const;
