/** What the exam's two routes decide from input they do not control: a URL, and a failed read. */
import { AppException, ErrorCodes, languageCodeSchema, type LanguageCode } from '@iace/contracts';

/** The languages a begin link carries. A deep link can say anything, so only real codes survive. */
export function examLanguagesFrom(param: string | readonly string[] | undefined): LanguageCode[] {
  const raw = typeof param === 'string' ? [param] : (param ?? []);
  const codes = raw
    .flatMap((part) => part.split(','))
    .map((part) => languageCodeSchema.safeParse(part))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  return [...new Set(codes)];
}

/** A queued marking job is the only reason the card 409s; anything else is a real failure. */
export const isMarkingPending = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT;
