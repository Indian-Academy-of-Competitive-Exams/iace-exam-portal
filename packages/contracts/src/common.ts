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
  .transform((v) => v.trim().replace(/[\s()-]/g, '').replace(/^(\+91|91|0)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address'));

export const otpCodeSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d{4,8}$/, 'Enter the code sent to you'));

/** Shape every non-2xx API response takes (NestJS HttpException body). */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
