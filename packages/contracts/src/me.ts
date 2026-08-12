import { z } from 'zod';
import { newPinSchema, pinSchema } from './common';
import { studentDetailSchema, updateStudentSchema } from './students';

// ============================================================================
// The student's own account.
//
// Everything here is scoped to the caller by their token — there is no id in
// any path or body. That is the whole security model of this module: a student
// cannot address another student's record because there is nowhere to put one.
// ============================================================================

/**
 * What a student may upload, and what each one is for.
 *
 * The kind is in the PATH rather than the body, so a request cannot ask to
 * overwrite a field it did not name — and the server decides which column each
 * kind writes to, not the client.
 */
export const DOCUMENT_KINDS = {
  PHOTO: 'photo',
  AADHAAR: 'aadhaar',
  PAN: 'pan',
} as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[keyof typeof DOCUMENT_KINDS];
export const DOCUMENT_KIND_VALUES = Object.values(DOCUMENT_KINDS) as [
  DocumentKind,
  ...DocumentKind[],
];

export const documentKindSchema = z.enum(DOCUMENT_KIND_VALUES);

/**
 * 5MB. A phone photo of an Aadhaar card is comfortably under it, and the limit
 * is a product rule rather than an environment one — every deployment should
 * refuse the same file.
 */
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/** What a browser may send. Checked server-side; the picker mirrors it. */
export const DOCUMENT_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/** A photo has to BE a photo — a PDF headshot is not one. */
export const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export function acceptedTypesFor(kind: DocumentKind): readonly string[] {
  return kind === DOCUMENT_KINDS.PHOTO ? PHOTO_ACCEPTED_TYPES : DOCUMENT_ACCEPTED_TYPES;
}

/**
 * The student's own record.
 *
 * The same shape the admin sees, documents included. It was briefly two
 * schemas, back when admins were kept away from the identity documents — that
 * rule is gone, so one definition is right again.
 */
export const meSchema = studentDetailSchema;
export type Me = z.infer<typeof meSchema>;

/**
 * What a student may change about themselves.
 *
 * `groupIds` is omitted, not optional. Group membership is what grants access
 * to tests, so a student who could set their own groups could enrol themselves
 * in any batch in the institute. Omitting it from the schema means zod strips
 * the key before it ever reaches the service — a request carrying one is not
 * rejected, it simply has no effect.
 */
export const updateMeSchema = updateStudentSchema.omit({ groupIds: true });
export type UpdateMeInput = z.input<typeof updateMeSchema>;
export type UpdateMeBody = z.infer<typeof updateMeSchema>;

/**
 * Changing the PIN.
 *
 * The current PIN is required even though the caller is already authenticated:
 * a session left open on a shared machine — a library, a friend's phone —
 * would otherwise be enough to lock the real owner out of their own account.
 *
 * The RESPONSE is a fresh session. Changing a PIN ends every session opened
 * with the old one, which would include the device doing the changing — so a
 * new one is issued for it, and the client must store the tokens it gets back.
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
  /** The kind is in the path — see DOCUMENT_KINDS. */
  document: (kind: DocumentKind) => `/me/documents/${kind}`,
} as const;

/** The multipart field an upload arrives under. Server and client must agree. */
export const DOCUMENT_FILE_FIELD = 'file';
