import { z } from 'zod';

/** Which identity table a token belongs to. Students and Admins are separate. */
export const actorTypeSchema = z.enum(['STUDENT', 'ADMIN']);
export type ActorType = z.infer<typeof actorTypeSchema>;

/**
 * Indian mobile number: 10 digits, leading 6-9. `+91` / `91` / `0` prefixes and
 * separators are stripped first, so clients may send any of the usual forms and
 * the stored value is always the bare 10 digits.
 */
export const mobileSchema = z
  .string()
  .transform((v) =>
    v
      .trim()
      .replace(/[\s()-]/g, '')
      .replace(/^(\+91|91|0)/, ''),
  )
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address'));

export const otpCodeSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d{4,8}$/, 'Enter the code sent to you'));

/**
 * The student login PIN: exactly 6 digits. Used when *entering* an existing PIN —
 * shape only, no strength rules, because an old PIN is verified against a hash
 * and extra rules here would only reject accounts that already exist.
 */
export const pinSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d{6}$/, 'Enter your 6-digit PIN'));

/** Straight runs in either direction — the other half of the obvious guesses. */
const SEQUENTIAL_PINS = new Set([
  '012345',
  '123456',
  '234567',
  '345678',
  '456789',
  '987654',
  '876543',
  '765432',
  '654321',
  '543210',
]);

/**
 * Used when *choosing* a PIN. A 6-digit secret is small enough that the Redis
 * attempt lockout is the real defence, but there is no reason to hand an
 * attacker `000000` or `123456` — the two shapes they try first.
 */
export const newPinSchema = pinSchema
  .refine((v) => !/^(\d)\1{5}$/.test(v), 'Avoid a PIN that is all one digit')
  .refine((v) => !SEQUENTIAL_PINS.has(v), 'Avoid a PIN in counting order');

/** Shape every non-2xx API response takes (NestJS HttpException body). */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
