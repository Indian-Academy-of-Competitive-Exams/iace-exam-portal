import { AppException } from '@iace/contracts';
import { type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';

/** Bridges the API's `fieldErrors` into react-hook-form; keys the form doesn't know, and the `_` catch-all, fall through to `bannerMessage` rather than being dropped. */

/** The server keys by full path (`profile.dob`); a form registers the leaf (`dob`). A key under an array index (`sections.0.name`) has no leaf: it belongs to that row alone. */
function leafOf(key: string): string | undefined {
  const parts = key.split('.');
  return parts.some((part) => /^\d+$/.test(part)) ? undefined : parts.at(-1);
}

function messagesFor(fieldErrors: Record<string, string[]>, field: string): string[] | undefined {
  if (fieldErrors[field]) return fieldErrors[field];
  const match = Object.keys(fieldErrors).find((key) => leafOf(key) === field);
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
    keys.every((key) => fields.includes(key) || fields.includes(leafOf(key) ?? key))
  );
}

/** What to show in the form's error banner, if anything. */
export function bannerMessage(error: unknown, fields: readonly string[] = []): string | null {
  if (!error) return null;
  if (isFullyFieldMapped(error, fields)) return null;
  if (AppException.is(error)) return error.message;
  return 'Something went wrong. Please try again.';
}
