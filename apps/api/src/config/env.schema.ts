import { z } from 'zod';
import { API_ROLES } from './api-role';
import { DURATION_PATTERN } from '../common/duration';

/** `"true"`/`"1"` → true. `z.coerce.boolean()` is wrong here: it makes the string "false" truthy. */
const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

/** One slash, not `\/+$`: the quantified form backtracks quadratically on a run of them. */
const TRAILING_SLASH = /\/$/;

/** A bad token lifetime fails at boot, not at the first sign-in that reads it. */
const DURATION_HINT = 'must be a duration like 15m, 24h or 30d';

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

/** `filterLogLevels`' vocabulary. Refused here so a typo is a boot failure, not silent full output. */
const logLevel = z
  .string()
  .optional()
  .refine(
    (v) => v === undefined || v.trim() === '' || /^(>=?)?[a-z]+(,[a-z]+)*$/.test(v.trim()),
    'must be a level like log, a threshold like >=warn, or a list like log,error',
  );

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
  // Declared for the refusal and the docs only: main.ts reads it off process.env before this exists.
  LOG_LEVEL: logLevel,
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // Auth. Length here, and the dev_only_ refusal below, are what keep a placeholder out of production.
  JWT_ACCESS_SECRET: z.string().min(24, 'JWT_ACCESS_SECRET must be at least 24 characters'),
  JWT_REFRESH_SECRET: z.string().min(24, 'JWT_REFRESH_SECRET must be at least 24 characters'),
  JWT_ACCESS_TTL: z.string().trim().regex(DURATION_PATTERN, DURATION_HINT).default('15m'),
  JWT_REFRESH_TTL: z.string().trim().regex(DURATION_PATTERN, DURATION_HINT).default('30d'),

  // OTP policy. Every byte of OTP state lives in Redis, never Postgres.
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(45),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_DAY: z.coerce.number().int().positive().default(10),
  // The address-wide twin of OTP_MAX_PER_DAY: a mobile's cap alone does not stop one address minting new numbers.
  OTP_MAX_PER_DAY_PER_IP: z.coerce.number().int().positive().default(3000),
  // The platform-wide kill switch on OTP spend, in paise — checked against NOTIFICATION_COST_SMS_PAISE.
  OTP_GLOBAL_DAILY_BUDGET_PAISE: z.coerce.number().int().positive().default(300_000),
  // What numbers with no account may spend in a day, apart from the above: a stranger cannot spend a student's sign-in.
  OTP_SIGNUP_DAILY_BUDGET_PAISE: z.coerce.number().int().positive().default(50_000),
  OTP_SENDER: z.enum(OTP_SENDERS).default(OTP_SENDERS.CONSOLE),

  // Rate limits per minute, generous because a branch of two hundred shares one address (.env.example).
  RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(120),
  // As wide as the shared auth bucket: every sign-in asks here, and a hall asks from one address.
  RATE_LIMIT_OTP_REQUEST_PER_MIN: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_SITTING_PER_MIN: z.coerce.number().int().positive().default(60),

  // Proxies in front. 0 trusts nothing; behind a load balancer this MUST be its hop count.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

  // Observability. A scraper identifies itself (.env.example).
  METRICS_TOKEN: optional,

  // Request body limits.
  BODY_LIMIT_DEFAULT: byteSize('256kb'),
  BODY_LIMIT_IMPORT: byteSize('10mb'),

  // Object storage. ONE code path: MinIO locally, AWS S3 in production — only the endpoint, credentials and path-style flag differ.
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
  SMS_TEMPLATE_RESULT_READY: optional,
  SMS_TEMPLATE_TEST_ASSIGNED: optional,
  SMS_TEMPLATE_TEST_REMINDER: optional,
  SMS_TEMPLATE_ANNOUNCEMENT: optional,

  // What one paid message costs in PAISE, so a preview is priced in what the invoice will say.
  NOTIFICATION_COST_WHATSAPP_PAISE: z.coerce.number().int().nonnegative().default(17),
  // Floor of 1: `assertGlobalDailyBudget` divides the OTP budget by it, and 0 would lift the cap.
  NOTIFICATION_COST_SMS_PAISE: z.coerce.number().int().positive().default(18),
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

/** Production always sits behind Caddy, so hops=0 keys every caller's rate limit to one address. */
const proxyIsCounted = (env: z.infer<typeof envSchema>): boolean =>
  env.NODE_ENV !== NODE_ENVS.PRODUCTION || env.TRUST_PROXY_HOPS > 0;

/** Every secret `.env.example` publishes is prefixed with this, so the prefix IS the marker. */
const DEV_ONLY_SECRET = 'dev_only_';

/** The 24-character floor passes these: the published placeholders are 49 characters long. */
const secretIsReal =
  (key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET') =>
  (env: z.infer<typeof envSchema>): boolean =>
    env.NODE_ENV !== NODE_ENVS.PRODUCTION || !env[key].startsWith(DEV_ONLY_SECRET);

/** Named once so the two messages cannot drift apart. */
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
      'and S3_SECRET_ACCESS_KEY go together, and both are required alongside S3_ENDPOINT — only AWS S3 can be reached by the instance role alone',
  })
  .refine(corsIsClosed, {
    path: ['CORS_ORIGINS'],
    message: 'is required in production — an empty list would let any site call the API',
  })
  .refine(metricsAreGuarded, {
    path: ['METRICS_TOKEN'],
    message: 'is required in production — /metrics would otherwise answer anybody who asked',
  })
  .refine(proxyIsCounted, {
    path: ['TRUST_PROXY_HOPS'],
    message:
      'must count the proxies in front of production (Caddy is 1) — at 0 every caller shares one rate-limit bucket and the hall locks itself out',
  })
  .refine(secretIsReal('JWT_ACCESS_SECRET'), {
    path: ['JWT_ACCESS_SECRET'],
    message: stillPublished('sign an access token for any student or admin'),
  })
  .refine(secretIsReal('JWT_REFRESH_SECRET'), {
    path: ['JWT_REFRESH_SECRET'],
    message: stillPublished('mint a session that never expires'),
  });

export type Env = z.infer<typeof envSchema>;

/** Fails the process at boot with every problem listed at once — a missing env var should never surface as a mystery 500 an hour into a live test. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchemaChecked.safeParse(raw);
  if (parsed.success) return parsed.data;

  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
}
