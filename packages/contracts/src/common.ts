import { z } from 'zod';

/**
 * Which identity table a token belongs to. Students and Admins are separate
 * tables with separate login rules, so this is not cosmetic — it decides which
 * table is read, which Redis keyspace is used, and which routes are reachable.
 *
 * Reference it as `ActorTypes.STUDENT`, never as the bare string. Same rule as
 * `ErrorCodes` in ./envelope, and for the same reasons.
 */
export const ActorTypes = {
  STUDENT: 'STUDENT',
  ADMIN: 'ADMIN',
} as const;

export type ActorType = (typeof ActorTypes)[keyof typeof ActorTypes];

export const actorTypeSchema = z.enum(ActorTypes);

/** An Indian mobile number, once normalised: 10 digits, leading 6-9. */
export const MOBILE_DIGITS = 10;

/** Country/trunk prefixes a student might type, longest first. */
const MOBILE_PREFIXES = ['+91', '0091', '91', '0'] as const;

/**
 * Reduces any of the usual forms to the bare 10 digits we store.
 *
 * A prefix is only stripped when doing so leaves exactly 10 digits. Stripping
 * it unconditionally corrupts real numbers: `9123456789` is a live series, and
 * blindly removing its leading "91" leaves 8 digits — so the owner of a
 * perfectly valid number is told their number is invalid and cannot sign up at
 * all. The length check is the whole fix.
 */
export function normaliseMobile(raw: string): string {
  const compact = raw.trim().replace(/[\s()-]/g, '');

  for (const prefix of MOBILE_PREFIXES) {
    if (compact.startsWith(prefix) && compact.length === prefix.length + MOBILE_DIGITS) {
      return compact.slice(prefix.length);
    }
  }
  return compact;
}

/**
 * Indian mobile number: 10 digits, leading 6-9. Accepts `+91`, `0091`, `91` and
 * `0` prefixes plus spaces, hyphens and parentheses; stores the bare digits.
 */
export const mobileSchema = z
  .string()
  .transform(normaliseMobile)
  .pipe(
    z
      .string()
      .regex(
        new RegExp(String.raw`^[6-9]\d{${MOBILE_DIGITS - 1}}$`),
        'Enter a valid 10-digit mobile number',
      ),
  );

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address'));

export const otpCodeSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d{4,8}$/, 'Enter the code sent to you'));

/** The one place the PIN length is decided. Everything else derives from it. */
export const PIN_LENGTH = 4;

/**
 * The student login PIN: exactly PIN_LENGTH digits. Used when *entering* an
 * existing PIN — shape only, no strength rules, because an old PIN is verified
 * against a hash and extra rules here would only reject accounts that already
 * exist.
 *
 * The PIN is NOT unique across students and is never expected to be: it is
 * salted-and-hashed per student, and a login is only ever checked against the
 * hash belonging to the one student that mobile number resolves to. Two
 * students sharing the PIN 4813 is unremarkable and invisible to both.
 */
export const pinSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .regex(new RegExp(String.raw`^\d{${PIN_LENGTH}}$`), `Enter your ${PIN_LENGTH}-digit PIN`),
  );

/** Straight runs in either direction — the other half of the obvious guesses. */
const SEQUENTIAL_PINS = new Set(
  Array.from({ length: 10 - PIN_LENGTH + 1 }, (_, start) => {
    const run = Array.from({ length: PIN_LENGTH }, (_, i) => start + i).join('');
    return [run, [...run].reverse().join('')];
  }).flat(),
);

/**
 * Used when *choosing* a PIN. Four digits is only 10,000 possibilities, so the
 * Redis attempt lockout is what actually protects it — but there is no reason
 * to hand an attacker `0000` or `1234`, which are the first things tried.
 */
export const newPinSchema = pinSchema
  .refine(
    (v) => !new RegExp(String.raw`^(\d)\1{${PIN_LENGTH - 1}}$`).test(v),
    'Avoid a PIN that is all one digit',
  )
  .refine((v) => !SEQUENTIAL_PINS.has(v), 'Avoid a PIN in counting order');

// The failure shape lives in ./envelope — there is one response envelope for
// the whole API, and NestJS's default error body is not it.
