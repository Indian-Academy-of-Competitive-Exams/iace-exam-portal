import { z } from 'zod';

/** `"true"`/`"1"` → true. `z.coerce.boolean()` is wrong here: it makes the
 *  string "false" truthy. */
const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Auth. Secrets are checked for length so a placeholder can't reach prod
  // unnoticed; the production values come from AWS Secrets Manager.
  JWT_ACCESS_SECRET: z.string().min(24, 'JWT_ACCESS_SECRET must be at least 24 characters'),
  JWT_REFRESH_SECRET: z.string().min(24, 'JWT_REFRESH_SECRET must be at least 24 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // OTP policy. Every byte of OTP state lives in Redis, never Postgres.
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(45),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_SENDER: z.enum(['console', 'msg91']).default('console'),

  // Student PIN policy. The PIN itself is argon2id-hashed in Postgres; the
  // attempt counters and the setup ticket live in Redis.
  //
  // The pepper is HMAC'd into the PIN before hashing and is NEVER stored with
  // it. A 6-digit PIN is only a million candidates — a leaked Student table
  // alone would fall to a laptop, so the hash is worthless without this secret.
  // Rotating it invalidates every PIN (students recover by OTP reset).
  PIN_PEPPER: z.string().min(24, 'PIN_PEPPER must be at least 24 characters'),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  PIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900),
  PIN_SETUP_TTL_SEC: z.coerce.number().int().positive().default(600),

  // Object storage. ONE code path: MinIO locally, AWS S3 in production —
  // only the endpoint, credentials and path-style flag differ.
  S3_ENDPOINT: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
  S3_FORCE_PATH_STYLE: boolFromEnv(false),
  S3_PUBLIC_URL: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Delivery providers — placeholders until MSG91 DLT registration lands.
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fails the process at boot with every problem listed at once — a missing env
 * var should never surface as a mystery 500 an hour into a live test.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
}
