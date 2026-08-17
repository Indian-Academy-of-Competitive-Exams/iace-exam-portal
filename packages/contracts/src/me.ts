import { z } from 'zod';
import { newPinSchema, pinSchema } from './common';
import { studentDetailSchema, updateStudentSchema } from './students';

// ============================================================================
// The student's own account, scoped by their token. There is no id in any path
// or body, so a student cannot address another student's record.
// ============================================================================

/** The kind is in the PATH, so a request cannot overwrite a field it did not name. */
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

/** 5MB — a product rule, not an environment one, so every deployment refuses the same file. */
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

/** The student's own record — the same shape the admin sees, documents included. */
export const meSchema = studentDetailSchema;
export type Me = z.infer<typeof meSchema>;

/**
 * `groupIds` is omitted, not optional: membership grants test access, and zod strips
 * the key before the service sees it, so a request carrying one has no effect.
 */
export const updateMeSchema = updateStudentSchema.omit({ groupIds: true });
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
  /** The kind is in the path — see DOCUMENT_KINDS. */
  document: (kind: DocumentKind) => `/me/documents/${kind}`,
} as const;

/** The multipart field an upload arrives under. Server and client must agree. */
export const DOCUMENT_FILE_FIELD = 'file';
