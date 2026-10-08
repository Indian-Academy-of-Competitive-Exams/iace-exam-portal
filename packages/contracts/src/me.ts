import { z } from 'zod';
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
  expectedUpdatedAt: true,
});
export type UpdateMeInput = z.input<typeof updateMeSchema>;
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

/** Every field a student's own save writes, under the name both of their forms give it. */
const OWN_DETAILS: readonly (readonly [label: string, read: (me: Me) => unknown])[] = [
  ['Full name', (me) => me.fullName],
  ["Mother's name", (me) => me.profile?.motherName],
  ["Father's name", (me) => me.profile?.fatherName],
  ['Date of birth', (me) => me.profile?.dob],
  ['Email', (me) => me.profile?.email],
  ['Address', (me) => me.profile?.address],
  ['Gender', (me) => me.profile?.gender],
  ['Education', (me) => me.profile?.educationDetails],
  ['Exams sat elsewhere', (me) => me.profile?.pastExamHistory],
];

/** Which of them differ between the record an edit began on and the record as it stands, by name; none while there is no edit to measure. */
export function ownDetailsMoved(opened: Me | null, latest: Me | undefined): string[] {
  if (!opened || !latest) return [];
  const held = (me: Me, read: (me: Me) => unknown) => JSON.stringify(read(me) ?? null);
  return OWN_DETAILS.filter(([, read]) => held(opened, read) !== held(latest, read)).map(
    ([label]) => label,
  );
}

export const ME_ROUTES = {
  profile: '/me',
  update: '/me',
  catalog: '/me/catalog',
  notifications: '/me/notifications',
  readNotification: (id: string) => `/me/notifications/${id}/read`,
  /** GET carries the key to subscribe with; POST subscribes this browser, DELETE drops it. */
  pushSubscription: '/me/push-subscription',
  /** POST registers this phone's FCM token, DELETE drops it. No GET: there is no key to hand out. */
  pushDevice: '/me/push-device',
  /** The kind is in the path — see DOCUMENT_KINDS. */
  document: (kind: DocumentKind) => `/me/documents/${kind}`,
  /** Where this student is signed in; DELETE on one signs that device out. */
  sessions: '/me/sessions',
  session: (id: string) => `/me/sessions/${id}`,
} as const;

/** The multipart field an upload arrives under. Server and client must agree. */
export const DOCUMENT_FILE_FIELD = 'file';

/** A browser File or an expo-file-system File; Expo's spec fetch refuses anything that is not a Blob. */
export type UploadFile = Blob;

// ============================================================================
// DPDP — erasure
// ============================================================================

/** What erasure left behind: the sittings are still counted, and the person is no longer named. */
export const erasureReceiptSchema = z.object({
  studentId: z.string(),
  anonymizedAt: z.string(),
  attemptsKept: z.number(),
});
export type ErasureReceipt = z.infer<typeof erasureReceiptSchema>;
