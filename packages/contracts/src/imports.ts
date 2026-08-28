import { z } from 'zod';
import { examFamilySchema } from './exams';
import { genderSchema, studentTypeSchema } from './students';

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

/** Where an import run got to. A plain string column, so this is the whole vocabulary. */
export const IMPORT_LOG_STATUS = {
  /** The file is stored and planned; nothing has been written yet. */
  PREVIEWED: 'PREVIEWED',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
} as const;
export const importLogStatusSchema = z.enum(IMPORT_LOG_STATUS);
export type ImportLogStatus = z.infer<typeof importLogStatusSchema>;

/** What a single line would do. `skip` means it has errors and will be left. */
export const studentImportActionSchema = z.enum(['create', 'update', 'skip']);
export type StudentImportAction = z.infer<typeof studentImportActionSchema>;

/** The profile columns, as one object — none of them is ever queried, so none of them is a column. */
export const studentImportProfileSchema = z.object({
  motherName: z.string().nullable(),
  fatherName: z.string().nullable(),
  dob: z.string().nullable(),
  email: z.string().nullable(),
  gender: genderSchema.nullable(),
  address: z.string().nullable(),
});
export type StudentImportProfile = z.infer<typeof studentImportProfileSchema>;

export const studentImportRowSchema = z.object({
  /** 1-based line in the uploaded file, header included, as an editor shows it. */
  line: z.number().int(),
  mobile: z.string().nullable(),
  fullName: z.string().nullable(),
  studentType: studentTypeSchema.nullable(),
  /** What the sheet said, kept for the preview so an unmatched name can be shown back. */
  branchName: z.string().nullable(),
  /** Resolved from the name against the live branch list. Null while the name did not match. */
  currentBranchId: z.string().nullable(),
  enrolledFamilies: z.array(examFamilySchema),
  enrolledExams: z.array(z.string()),
  programs: z.array(z.string()),
  profile: studentImportProfileSchema,
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
  /** Wrong with the SOURCE rather than a row — a missing column, an empty upload, an unreachable portal. */
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

/** A scholarship intake: an enrolment list, never a roster, so a known mobile ONLY earns a grant. */
export const scholarshipImportActionSchema = z.enum(['create', 'grant', 'skip']);
export type ScholarshipImportAction = z.infer<typeof scholarshipImportActionSchema>;

export const scholarshipImportRowSchema = z.object({
  line: z.number().int(),
  mobile: z.string().nullable(),
  fullName: z.string().nullable(),
  /** Set when the number already belongs to a LIVE student — this row grants and writes nothing else. */
  existingStudentId: z.string().nullable(),
  willReceiveDefaultPin: z.boolean(),
  action: scholarshipImportActionSchema,
  errors: z.array(z.string()),
});
export type ScholarshipImportRow = z.infer<typeof scholarshipImportRowSchema>;

export const scholarshipImportSummarySchema = z.object({
  total: z.number().int(),
  willCreate: z.number().int(),
  willGrant: z.number().int(),
  invalid: z.number().int(),
});
export type ScholarshipImportSummary = z.infer<typeof scholarshipImportSummarySchema>;

export const scholarshipImportPlanSchema = z.object({
  rows: z.array(scholarshipImportRowSchema),
  summary: scholarshipImportSummarySchema,
  fileErrors: z.array(z.string()),
});
export type ScholarshipImportPlan = z.infer<typeof scholarshipImportPlanSchema>;

export const scholarshipImportResultSchema = scholarshipImportSummarySchema.extend({
  created: z.number().int(),
  granted: z.number().int(),
  skipped: z.number().int(),
});
export type ScholarshipImportResult = z.infer<typeof scholarshipImportResultSchema>;

export const IMPORT_ROUTES = {
  studentsPreview: '/imports/students/preview',
  studentsCommit: '/imports/students/commit',
  /** The same two steps, with the main portal as the source instead of an upload. */
  studentsPortalPreview: '/imports/students/portal/preview',
  studentsPortalCommit: '/imports/students/portal/commit',
  /** The sample workbook, generated from STUDENT_IMPORT_COLUMNS below. */
  studentsTemplate: '/imports/students/template',
  /** A scholarship intake is filed against the series it enrols into. */
  scholarshipPreview: (seriesId: string) => `/imports/scholarship/${seriesId}/preview`,
  scholarshipCommit: (seriesId: string) => `/imports/scholarship/${seriesId}/commit`,
  /** The sample workbook, generated from SCHOLARSHIP_IMPORT_COLUMNS. */
  scholarshipTemplate: '/imports/scholarship/template',
} as const;

/** What the sample file is called when it lands in the admin's downloads. */
export const STUDENT_IMPORT_TEMPLATE_FILENAME = 'iace-students-template.xlsx';

/** What the scholarship sample is called when it lands in the admin's downloads. */
export const SCHOLARSHIP_IMPORT_TEMPLATE_FILENAME = 'iace-scholarship-template.xlsx';

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
    key: 'studentType',
    header: 'Student Type',
    width: 16,
    required: true,
    aliases: ['studenttype', 'type', 'mode', 'studentmode'],
  },
  {
    key: 'branchName',
    header: 'Branch Name',
    width: 22,
    // The NAME, never the id: nobody filling a spreadsheet has a cuid to hand.
    required: true,
    aliases: ['branchname', 'branch', 'centre', 'center', 'branchcentre'],
  },
  {
    key: 'enrolledFamilies',
    header: 'Enrolled Families',
    width: 24,
    required: true,
    aliases: ['enrolledfamilies', 'enrolledfamily', 'families', 'family', 'examfamily'],
  },
  {
    key: 'enrolledExams',
    header: 'Enrolled Exams',
    width: 26,
    required: true,
    aliases: ['enrolledexams', 'enrolledexam', 'exams', 'exam', 'examcodes', 'examcode'],
  },
  {
    key: 'programs',
    header: 'Programs',
    width: 26,
    required: true,
    aliases: ['programs', 'program', 'programcodes', 'programcode', 'course', 'courses'],
  },
  {
    key: 'motherName',
    header: "Mother's Name",
    width: 24,
    required: false,
    aliases: ["mother'sname", 'mothersname', 'mothername', 'mother'],
  },
  {
    key: 'fatherName',
    header: "Father's Name",
    width: 24,
    required: false,
    aliases: ["father'sname", 'fathersname', 'fathername', 'father', 'guardianname'],
  },
  {
    key: 'dob',
    header: 'Date of Birth',
    width: 16,
    required: false,
    aliases: ['dateofbirth', 'dob', 'birthdate', 'birthday'],
  },
  {
    key: 'email',
    header: 'Email',
    width: 28,
    required: false,
    aliases: ['email', 'emailaddress', 'mail', 'emailid'],
  },
  {
    key: 'gender',
    header: 'Gender',
    width: 12,
    required: false,
    aliases: ['gender', 'sex'],
  },
  {
    key: 'address',
    header: 'Address',
    width: 36,
    required: false,
    aliases: ['address', 'residentialaddress', 'postaladdress', 'fulladdress'],
  },
] as const;

/** How a cell holding several codes is written — any of these, so either style imports. */
export const IMPORT_LIST_SEPARATORS = /[,;|/\n]+/;

/** A row naming none of family, exam or program creates a student who reaches nothing. */
export const NO_ACCESS_ROUTE_MESSAGE =
  'This row reaches no test series — give it an enrolled family, an enrolled exam or a program.';

export type StudentImportColumn = (typeof STUDENT_IMPORT_COLUMNS)[number];
export type StudentImportColumnKey = StudentImportColumn['key'];

/** The roster list FILTERED, never restated: the sample and the parser read one set of aliases. */
export const SCHOLARSHIP_IMPORT_COLUMNS = STUDENT_IMPORT_COLUMNS.filter(
  (column) => column.key === 'mobile' || column.key === 'fullName',
);
