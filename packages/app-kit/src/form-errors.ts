import { AppException, type ErrorCode } from '@iace/contracts';
import { type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';

/**
 * Bridges the API's `fieldErrors` into react-hook-form.
 *
 * The server validates with the same zod schema the form does, so when it
 * rejects something the client let through — a burnt OTP, a PIN the lockout
 * refuses — the message belongs on the field, not in a banner far from it.
 * Keys the form does not know (and the `_` catch-all for whole-body issues)
 * fall through to `bannerMessage` instead of being dropped.
 */

/**
 * The server keys nested problems by their full path (`profile.dob`), while a
 * form registers flat names (`dob`). Matching on the leaf as well as the whole
 * key lets one message reach the input that caused it without the form having
 * to know how the request body was nested.
 */
function messagesFor(fieldErrors: Record<string, string[]>, field: string): string[] | undefined {
  if (fieldErrors[field]) return fieldErrors[field];
  const match = Object.keys(fieldErrors).find((key) => key.split('.').at(-1) === field);
  return match ? fieldErrors[match] : undefined;
}

export function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  if (!AppException.is(error) || !error.fieldErrors) return;

  for (const field of fields) {
    const messages = messagesFor(error.fieldErrors, field);
    if (messages?.[0]) setError(field, { type: 'server', message: messages[0] });
  }
}

/** True when every message in the error already sits on a form field. */
export function isFullyFieldMapped(error: unknown, fields: readonly string[]): boolean {
  if (!AppException.is(error) || !error.fieldErrors) return false;
  const keys = Object.keys(error.fieldErrors);
  return (
    keys.length > 0 &&
    keys.every((key) => fields.includes(key) || fields.includes(key.split('.').at(-1) ?? key))
  );
}

/** What to show in the form's error banner, if anything. */
export function bannerMessage(error: unknown, fields: readonly string[] = []): string | null {
  if (!error) return null;
  if (isFullyFieldMapped(error, fields)) return null;
  if (AppException.is(error)) return error.message;
  return 'Something went wrong. Please try again.';
}

/** For the few places that branch on what went wrong rather than just show it. */
export function errorCodeOf(error: unknown): ErrorCode | null {
  return AppException.is(error) ? error.code : null;
}
