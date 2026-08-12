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
 * The student's own record.
 *
 * Deliberately the same shape the admin sees, which means it also omits the
 * Aadhaar and PAN links. That is a limit worth naming: the student SHOULD be
 * able to see their own documents, and this will need its own schema the moment
 * uploading them exists. Sharing it today avoids two definitions that agree on
 * everything.
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
} as const;
