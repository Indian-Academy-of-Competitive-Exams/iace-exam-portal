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
const DOCUMENT_KIND_VALUES = Object.values(DOCUMENT_KINDS) as [DocumentKind, ...DocumentKind[]];

export const documentKindSchema = z.enum(DOCUMENT_KIND_VALUES);

/** 5MB — a product rule, not an environment one, so every deployment refuses the same file. */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** A photo has to BE a photo — a PDF headshot is not one. Checked server-side; the picker mirrors it. */
const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A marksheet is usually scanned or photographed, so it takes a PDF as well as an image. */
const MARKSHEET_ACCEPTED_TYPES = [...PHOTO_ACCEPTED_TYPES, 'application/pdf'] as const;

/** What each kind will take. The server decides; the picker reads the same map so they agree. */
export const ACCEPTED_TYPES_FOR: Record<DocumentKind, readonly string[]> = {
  [DOCUMENT_KINDS.PHOTO]: PHOTO_ACCEPTED_TYPES,
  [DOCUMENT_KINDS.TENTH_MARKSHEET]: MARKSHEET_ACCEPTED_TYPES,
};

/** One code the student carries, beside the catalog's name for it. */
const enrolmentNameSchema = z.object({
  code: z.string(),
  /** A code with no catalog row keeps its own code here, so a row never renders blank. */
  name: z.string(),
});
export type EnrolmentName = z.infer<typeof enrolmentNameSchema>;

/** What the student's record says they stand on, resolved to names a screen can print. */
const enrolmentStandingSchema = z.object({
  programs: z.array(enrolmentNameSchema),
  exams: z.array(enrolmentNameSchema),
  branch: z.string().nullable(),
});
export type EnrolmentStanding = z.infer<typeof enrolmentStandingSchema>;

/** The admin's shape plus the enrolment resolved for reading — the student sees names, not codes. */
export const meSchema = studentDetailSchema.extend({ enrolment: enrolmentStandingSchema });
export type Me = z.infer<typeof meSchema>;

/** An allowlist, never an omit: everything a student may set about themselves is named here, so a field added to the admin patch can't become self-writable by omission. */
export const updateMeSchema = updateStudentSchema.pick({
  fullName: true,
  profile: true,
});
export type UpdateMeInput = z.input<typeof updateMeSchema>;
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

/** The current PIN is required despite the session: one left open on a shared machine would otherwise lock the owner out; the response is a fresh session — store it. */
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
  /** GET carries the key to subscribe with; POST subscribes this browser, DELETE drops it. */
  pushSubscription: '/me/push-subscription',
  /** POST registers this phone's FCM token, DELETE drops it. No GET: there is no key to hand out. */
  pushDevice: '/me/push-device',
  /** The kind is in the path — see DOCUMENT_KINDS. */
  document: (kind: DocumentKind) => `/me/documents/${kind}`,
  /** Irreversible, and not a delete: every sitting stays, and none of them names anybody. */
  erasure: '/me/erasure',
  /** Where this student is signed in; DELETE on one signs that device out. */
  sessions: '/me/sessions',
  session: (id: string) => `/me/sessions/${id}`,
} as const;

/** The multipart field an upload arrives under. Server and client must agree. */
export const DOCUMENT_FILE_FIELD = 'file';

/** A browser File, or the descriptor React Native's own FormData takes in place of one. */
export type UploadFile = File | { uri: string; name: string; type: string };

// ============================================================================
// DPDP — the copy a student may take away, and erasure
// ============================================================================

/** One sitting, as it appears in a student's own copy of their data — marks, never the paper. */
const exportedAttemptSchema = z.object({
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
