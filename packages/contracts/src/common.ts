import { z } from 'zod';

/**
 * Which identity table a token belongs to — it decides the table, the Redis keyspace
 * and the reachable routes. Reference it as `ActorTypes.STUDENT`, never the bare string.
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
 * Reduces the usual forms to the bare 10 digits. A prefix is stripped ONLY when that
 * leaves 10: `9123456789` is a live series, and taking its "91" leaves 8.
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

/** 10 digits, leading 6-9. Accepts the usual prefixes and separators; stores bare digits. */
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
 * Entering an existing PIN: shape only, or the rules would reject accounts that exist.
 * A PIN is not unique across students — it is only checked against the one a mobile resolves to.
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

/** Choosing a PIN. The Redis lockout is the real protection; this only refuses the obvious ones. */
export const newPinSchema = pinSchema
  .refine(
    (v) => !new RegExp(String.raw`^(\d)\1{${PIN_LENGTH - 1}}$`).test(v),
    'Avoid a PIN that is all one digit',
  )
  .refine((v) => !SEQUENTIAL_PINS.has(v), 'Avoid a PIN in counting order');

// The failure shape lives in ./envelope — there is one response envelope for
// the whole API, and NestJS's default error body is not it.
