import { z } from 'zod';
import { newPinSchema, pinSchema } from './common';
import { studentDetailSchema, updateStudentSchema } from './students';

// ============================================================================
// The student's own account, scoped by their token. There is no id in any path
// or body, so a student cannot address another student's record.
// ============================================================================

/** The kind is in the PATH, so a request cannot overwrite a field it did not name. */
/** Aadhaar and PAN are absent deliberately: their images are never stored, only a verified flag. */
export const DOCUMENT_KINDS = {
  PHOTO: 'photo',
  TENTH_MARKSHEET: 'tenth-marksheet',
} as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[keyof typeof DOCUMENT_KINDS];
export const DOCUMENT_KIND_VALUES = Object.values(DOCUMENT_KINDS) as [
  DocumentKind,
  ...DocumentKind[],
];

export const documentKindSchema = z.enum(DOCUMENT_KIND_VALUES);

/** 5MB — a product rule, not an environment one, so every deployment refuses the same file. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** A photo has to BE a photo — a PDF headshot is not one. Checked server-side; the picker mirrors it. */
export const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A marksheet is usually scanned or photographed, so it takes a PDF as well as an image. */
export const MARKSHEET_ACCEPTED_TYPES = [...PHOTO_ACCEPTED_TYPES, 'application/pdf'] as const;

/** What each kind will take. The server decides; the picker reads the same map so they agree. */
export const ACCEPTED_TYPES_FOR: Record<DocumentKind, readonly string[]> = {
  [DOCUMENT_KINDS.PHOTO]: PHOTO_ACCEPTED_TYPES,
  [DOCUMENT_KINDS.TENTH_MARKSHEET]: MARKSHEET_ACCEPTED_TYPES,
};

/** The student's own record — the same shape the admin sees. */
export const meSchema = studentDetailSchema;
export type Me = z.infer<typeof meSchema>;

/**
 * An allowlist, never an omit: everything a student may set about themselves is named here, so
 * a field added to the admin patch cannot become self-writable by forgetting to exclude it.
 */
export const updateMeSchema = updateStudentSchema.pick({
  fullName: true,
  profile: true,
});
export type UpdateMeInput = z.input<typeof updateMeSchema>;
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

/**
 * The current PIN is required despite the session: one left open on a shared machine
 * would otherwise lock the owner out. The response is a fresh session — store it.
 */
export const changePinSchema = z
  .object({
    currentPin: pinSchema,
    newPin: newPinSchema,
  })
  .refine((value) => value.currentPin !== value.newPin, {
    message: 'Choose a PIN you have not used before',
    path: ['newPin'],
  });
export type ChangePinInput = z.input<typeof changePinSchema>;
export type ChangePinBody = z.infer<typeof changePinSchema>;

export const ME_ROUTES = {
  profile: '/me',
  update: '/me',
  changePin: '/me/pin',
  catalog: '/me/catalog',
  notifications: '/me/notifications',
  readNotification: (id: string) => `/me/notifications/${id}/read`,
  /** The kind is in the path — see DOCUMENT_KINDS. */
  document: (kind: DocumentKind) => `/me/documents/${kind}`,
  consent: '/me/consent',
  dataExport: '/me/data-export',
  /** Irreversible, and not a delete: every sitting stays, and none of them names anybody. */
  erasure: '/me/erasure',
} as const;

/** The multipart field an upload arrives under. Server and client must agree. */
export const DOCUMENT_FILE_FIELD = 'file';

// ============================================================================
// DPDP — consent, the copy a student may take away, and erasure
// ============================================================================

/** One purpose in V1: running the platform for them. A second is a value here, never a column. */
export const CONSENT_PURPOSE = { PLATFORM: 'PLATFORM' } as const;
export const consentPurposeSchema = z.enum(CONSENT_PURPOSE);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

/** The newest answer for one purpose. Absent means never asked, which is not the same as refused. */
export const consentStateSchema = z.object({
  purpose: consentPurposeSchema,
  version: z.string(),
  granted: z.boolean(),
  recordedAt: z.string(),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

export const consentStatusSchema = z.object({
  /** What the notice says today. A `current` newer than every record means it wants asking again. */
  current: z.string(),
  records: z.array(consentStateSchema),
});
export type ConsentStatus = z.infer<typeof consentStatusSchema>;

export const recordConsentSchema = z.object({
  purpose: consentPurposeSchema.default(CONSENT_PURPOSE.PLATFORM),
  version: z.string().min(1, 'Say which notice this answers'),
  granted: z.boolean(),
});
export type RecordConsentBody = z.infer<typeof recordConsentSchema>;
export type RecordConsentInput = z.input<typeof recordConsentSchema>;

/** One sitting, as it appears in a student's own copy of their data — marks, never the paper. */
export const exportedAttemptSchema = z.object({
  id: z.string(),
  testId: z.string(),
  testName: z.string(),
  status: z.string(),
  startedAt: z.string().nullable(),
  submittedAt: z.string().nullable(),
  score: z.number().nullable(),
  percentile: z.number().nullable(),
});

/** Everything the platform holds ABOUT one student, in the shape they can read. */
export const studentDataExportSchema = z.object({
  exportedAt: z.string(),
  student: z.object({
    id: z.string(),
    mobile: z.string(),
    fullName: z.string().nullable(),
    studentType: z.string(),
    branch: z.string().nullable(),
    enrolledExams: z.array(z.string()),
    enrolledCourses: z.array(z.string()),
    programs: z.array(z.string()),
    createdAt: z.string(),
  }),
  profile: z
    .object({
      motherName: z.string().nullable(),
      fatherName: z.string().nullable(),
      dob: z.string().nullable(),
      email: z.string().nullable(),
      address: z.string().nullable(),
      gender: z.string().nullable(),
      photoUrl: z.string().nullable(),
      aadhaarVerified: z.boolean(),
      panVerified: z.boolean(),
      educationDetails: z.unknown().nullable(),
      pastExamHistory: z.unknown().nullable(),
    })
    .nullable(),
  consents: z.array(consentStateSchema),
  attempts: z.array(exportedAttemptSchema),
});
export type StudentDataExport = z.infer<typeof studentDataExportSchema>;

/** What erasure left behind: the sittings are still counted, and the person is no longer named. */
export const erasureReceiptSchema = z.object({
  studentId: z.string(),
  anonymizedAt: z.string(),
  attemptsKept: z.number(),
});
export type ErasureReceipt = z.infer<typeof erasureReceiptSchema>;
