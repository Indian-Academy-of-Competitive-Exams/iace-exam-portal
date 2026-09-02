import { z } from 'zod';

/** `"true"`/`"1"` → true. `z.coerce.boolean()` is wrong here: it makes the
 *  string "false" truthy. */
const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

/** A comma-separated ladder of positive second counts, e.g. "900,3600,86400". */
const secondsLadder = (fallback: number[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? fallback
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map(Number),
    )
    .refine(
      (steps) => steps.length > 0 && steps.every((n) => Number.isInteger(n) && n > 0),
      'must be a comma-separated list of positive whole seconds, e.g. 900,3600,86400',
    )
    .refine(
      (steps) => steps.every((n, i) => i === 0 || n >= (steps[i - 1] ?? 0)),
      'must not decrease — each lockout step should be at least as long as the one before',
    );

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** The environments the API knows about. `isProduction` etc. compare against these. */
export const NODE_ENVS = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

/**
 * OTP delivery channels. CONSOLE prints the code to the API log and is refused outright in
 * production (see AuthModule); MSG91 is the DLT-registered SMS sender that replaces it.
 */
export const OTP_SENDERS = {
  CONSOLE: 'console',
  MSG91: 'msg91',
} as const;

/** A body-parser size, in the form `bytes` understands: 100b, 256kb, 10mb. */
const byteSize = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : v.trim().toLowerCase()))
    .refine(
      (v) => /^\d+(b|kb|mb)$/.test(v),
      'must be a size like 256kb or 10mb (bytes, kilobytes or megabytes)',
    );

export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default(NODE_ENVS.DEVELOPMENT),
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
  OTP_SENDER: z.enum(OTP_SENDERS).default(OTP_SENDERS.CONSOLE),

  // Student PIN policy. The PIN itself is argon2id-hashed in Postgres; the attempt counters and the
  // setup ticket live in Redis.
  PIN_PEPPER: z.string().min(24, 'PIN_PEPPER must be at least 24 characters'),
  PIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // Escalating lockout. Each time a number is locked out again it climbs one rung; the last rung
  // repeats forever.
  PIN_LOCKOUT_STEPS_SEC: secondsLadder([900, 3600, 86400]),
  // How long a number must go without being locked out before the ladder drops back to the first
  // rung.
  PIN_LOCKOUT_DECAY_SEC: z.coerce.number().int().positive().default(86400),
  PIN_SETUP_TTL_SEC: z.coerce.number().int().positive().default(600),

  // Request body limits.
  BODY_LIMIT_DEFAULT: byteSize('256kb'),
  BODY_LIMIT_IMPORT: byteSize('10mb'),

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

/** An empty allowlist reflects whatever origin asks, which is no allowlist at all. */
const corsIsClosed = (env: z.infer<typeof envSchema>): boolean =>
  env.NODE_ENV !== NODE_ENVS.PRODUCTION || env.CORS_ORIGINS.length > 0;

export const envSchemaChecked = envSchema.refine(corsIsClosed, {
  path: ['CORS_ORIGINS'],
  message: 'is required in production — an empty list would let any site call the API',
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fails the process at boot with every problem listed at once — a missing env var should never
 * surface as a mystery 500 an hour into a live test.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchemaChecked.safeParse(raw);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
}
