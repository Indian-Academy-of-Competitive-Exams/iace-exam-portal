import { z } from 'zod';
import { API_ROLES } from './api-role';

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

/** One slash, not `\/+$`: the quantified form backtracks quadratically on a run of them. */
const TRAILING_SLASH = /\/$/;

/** An unset variable and one set to nothing mean the same thing: not configured. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

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

/** Outbound delivery. CONSOLE is refused in production; WHATSAPP still needs SMS behind it. */
export const OTP_SENDERS = {
  CONSOLE: 'console',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
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
  // Which half a container is; here so a typo is refused at boot rather than serving nothing.
  API_ROLE: z.enum(API_ROLES).default(API_ROLES.ALL),
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Auth. Length here, and the dev_only_ refusal below, are what keep a placeholder out of production.
  JWT_ACCESS_SECRET: z.string().min(24, 'JWT_ACCESS_SECRET must be at least 24 characters'),
  JWT_REFRESH_SECRET: z.string().min(24, 'JWT_REFRESH_SECRET must be at least 24 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // OTP policy. Every byte of OTP state lives in Redis, never Postgres.
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(45),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_DAY: z.coerce.number().int().positive().default(5),
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

  // Rate limits per minute, generous because a branch of two hundred shares one address (.env.example).
  RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_SITTING_PER_MIN: z.coerce.number().int().positive().default(60),

  // Proxies in front. 0 trusts nothing; behind a load balancer this MUST be its hop count.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

  // Observability. A scraper identifies itself; Sentry is inert without a DSN (.env.example).
  METRICS_TOKEN: optional,
  SENTRY_DSN: optional,
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

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
  // Unset on AWS: the task's own role signs, so there is no key to store, leak or rotate.
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: boolFromEnv(false),

  // Where content images are READ from — stable and unsigned, so the CDN caches one copy for everyone.
  MEDIA_BASE_URL: z
    .string()
    .min(1, 'MEDIA_BASE_URL is required')
    .transform((v) => v.trim().replace(TRAILING_SLASH, '')),

  // The SMS aggregator, named nowhere: a swap is these three values, not a code change.
  SMS_PROVIDER_URL: optional,
  SMS_PROVIDER_KEY: optional,
  SMS_SENDER_ID: z.string().default(''),

  // The Gmail account an admin's OTP comes from. MAIL_PASSWORD is a Google app password.
  MAIL_USER: optional,
  MAIL_PASSWORD: optional,

  // One DLT template id per message kind. An empty one turns that message off rather than breaking it.
  SMS_TEMPLATE_OTP: optional,
  SMS_TEMPLATE_PIN: optional,
  SMS_TEMPLATE_RESULT_READY: optional,
  SMS_TEMPLATE_TEST_ASSIGNED: optional,
  SMS_TEMPLATE_TEST_REMINDER: optional,
  SMS_TEMPLATE_ANNOUNCEMENT: optional,

  // What one paid message costs in PAISE, so a preview is priced in what the invoice will say.
  NOTIFICATION_COST_WHATSAPP_PAISE: z.coerce.number().int().nonnegative().default(17),
  NOTIFICATION_COST_SMS_PAISE: z.coerce.number().int().nonnegative().default(18),
  // The wall a mistargeted broadcast hits instead of an invoice.
  NOTIFICATION_MAX_RECIPIENTS: z.coerce.number().int().positive().default(50000),

  // Web push, all three or none: any one missing and the channel reports itself unavailable.
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional,

  // Mobile push through FCM, all three or none — three fields of one service account, never a file.
  FCM_PROJECT_ID: optional,
  FCM_CLIENT_EMAIL: optional,
  FCM_PRIVATE_KEY: optional,

  // The language a template was REGISTERED in. A mismatch is rejected, not translated.
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),
  WHATSAPP_INTERAKT_URL: z.string().default('https://api.interakt.ai/v1/public/message/'),
  // The one WhatsApp vendor, and the whole switch: unset routes the channel nowhere.
  WHATSAPP_INTERAKT_API_KEY: optional,

  // One approved template name per kind, same rule as the DLT ids above.
  WHATSAPP_TEMPLATE_OTP: optional,
  WHATSAPP_TEMPLATE_PIN: optional,
  WHATSAPP_TEMPLATE_RESULT_READY: optional,
  WHATSAPP_TEMPLATE_TEST_ASSIGNED: optional,
  WHATSAPP_TEMPLATE_TEST_REMINDER: optional,
  WHATSAPP_TEMPLATE_ANNOUNCEMENT: optional,
});

/** MinIO has no roles to borrow, so an endpoint of our own must bring a key with it. */
const storageCanSign = (env: z.infer<typeof envSchema>): boolean => {
  const pair = [env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
  // Exactly one half given is a key nobody can sign with, which is worse than neither.
  if (pair.filter((half) => half !== undefined).length === 1) return false;
  return env.S3_ENDPOINT === undefined || pair.every((half) => half !== undefined);
};

/** An empty allowlist reflects whatever origin asks, which is no allowlist at all. */
const corsIsClosed = (env: z.infer<typeof envSchema>): boolean =>
  env.NODE_ENV !== NODE_ENVS.PRODUCTION || env.CORS_ORIGINS.length > 0;

/** Live attempt counts and error rates are worth something to somebody who should not have them. */
const metricsAreGuarded = (env: z.infer<typeof envSchema>): boolean =>
  env.NODE_ENV !== NODE_ENVS.PRODUCTION || env.METRICS_TOKEN !== undefined;

/** Prisma sizes its pool from the URL alone, and one container's worker slots outnumber the default. */
const poolIsSized = (env: z.infer<typeof envSchema>): boolean =>
  env.NODE_ENV !== NODE_ENVS.PRODUCTION || /[?&]connection_limit=\d/.test(env.DATABASE_URL);

/** Every secret `.env.example` publishes is prefixed with this, so the prefix IS the marker. */
const DEV_ONLY_SECRET = 'dev_only_';

/** The 24-character floor passes these: the published placeholders are 49 characters long. */
const secretIsReal =
  (key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'PIN_PEPPER') =>
  (env: z.infer<typeof envSchema>): boolean =>
    env.NODE_ENV !== NODE_ENVS.PRODUCTION || !env[key].startsWith(DEV_ONLY_SECRET);

/** Named once so the three messages cannot drift apart. */
const stillPublished = (forges: string): string =>
  `is still the dev_only_ placeholder .env.example publishes — anybody with the repo could ${forges}`;

export const envSchemaChecked = envSchema
  .refine(poolIsSized, {
    path: ['DATABASE_URL'],
    message:
      'needs connection_limit in production — the default pool is smaller than the 20 worker slots one container runs',
  })
  .refine(storageCanSign, {
    path: ['S3_ACCESS_KEY_ID'],
    message:
      'and S3_SECRET_ACCESS_KEY go together, and both are required alongside S3_ENDPOINT — only AWS S3 can be reached by the task role alone',
  })
  .refine(corsIsClosed, {
    path: ['CORS_ORIGINS'],
    message: 'is required in production — an empty list would let any site call the API',
  })
  .refine(metricsAreGuarded, {
    path: ['METRICS_TOKEN'],
    message: 'is required in production — /metrics would otherwise answer anybody who asked',
  })
  .refine(secretIsReal('JWT_ACCESS_SECRET'), {
    path: ['JWT_ACCESS_SECRET'],
    message: stillPublished('sign an access token for any student or admin'),
  })
  .refine(secretIsReal('JWT_REFRESH_SECRET'), {
    path: ['JWT_REFRESH_SECRET'],
    message: stillPublished('mint a session that never expires'),
  })
  .refine(secretIsReal('PIN_PEPPER'), {
    path: ['PIN_PEPPER'],
    message: stillPublished('test a stolen PIN hash offline'),
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
