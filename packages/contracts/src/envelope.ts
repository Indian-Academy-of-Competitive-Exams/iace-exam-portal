import { z, type ZodType } from 'zod';

// ============================================================================
// The one response envelope.
//
// Every response this API produces has exactly one of two shapes:
//
//   success  { success: true,  data, meta }
//   failure  { success: false, error: { code, message, fieldErrors? }, meta }
//
// Nothing else is possible: the API wraps handler returns in a response
// interceptor and funnels every thrown value through one exception filter, so a
// controller literally cannot emit another shape. The typed client is the
// mirror image — it unwraps `data` and throws `AppException` on failure, so
// React Query only ever sees plain data or a typed error.
//
// React to `error.code`. Never string-match `message`: the codes are a stable
// contract, the wording is not.
// ============================================================================

/**
 * The stable error vocabulary, declared once. Add to it; never repurpose an
 * existing member — a code that changes meaning breaks every client that was
 * branching on it, silently.
 *
 * ALWAYS throw with the constant, never the bare string:
 *
 *     throw new AppException(ErrorCodes.PIN_LOCKED, '…');   // yes
 *     throw new AppException('PIN_LOCKED', '…');            // no
 *
 * Both compile — the type is a union of literals — but only the first fails at
 * the call site when a code is renamed, and only the first is findable by
 * "go to references" when you need every place a code is raised.
 */
export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  PIN_LOCKED: 'PIN_LOCKED',
  PIN_INVALID: 'PIN_INVALID',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Every code, in declaration order — for exhaustive checks and docs. */
export const ERROR_CODES = Object.values(ErrorCodes);

export const errorCodeSchema = z.enum(ErrorCodes);

/**
 * The HTTP status each code answers with. Callers should branch on the code,
 * but the status still has to be right for proxies, caches and the browser.
 */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.UNAUTHENTICATED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
  // A wrong or stale credential is an authentication failure, not a malformed
  // request — the body was perfectly well-formed.
  [ErrorCodes.OTP_INVALID]: 401,
  [ErrorCodes.OTP_EXPIRED]: 401,
  [ErrorCodes.PIN_INVALID]: 401,
  // Locked is a throttle, and 429 is what tells a client to back off.
  [ErrorCodes.PIN_LOCKED]: 429,
  [ErrorCodes.INTERNAL]: 500,
};

/** Fallback wording, so `throw new AppException(ErrorCodes.NOT_FOUND)` reads fine. */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCodes.VALIDATION_ERROR]: 'Some of the details are not valid',
  [ErrorCodes.UNAUTHENTICATED]: 'Please sign in to continue',
  [ErrorCodes.FORBIDDEN]: 'You do not have access to this',
  [ErrorCodes.NOT_FOUND]: 'Not found',
  [ErrorCodes.CONFLICT]: 'That already exists',
  [ErrorCodes.RATE_LIMITED]: 'Too many requests — please wait a moment',
  [ErrorCodes.OTP_INVALID]: 'Incorrect code',
  [ErrorCodes.OTP_EXPIRED]: 'That code has expired — request a new one',
  [ErrorCodes.PIN_INVALID]: 'Incorrect mobile number or PIN',
  [ErrorCodes.PIN_LOCKED]: 'Too many incorrect attempts — try again later',
  [ErrorCodes.INTERNAL]: 'Something went wrong. Please try again.',
};

// ============================================================================
// Shapes
// ============================================================================

/**
 * Rides on every response, success or failure. `requestId` is echoed in the
 * `X-Request-Id` header and in the server log line for the same request, which
 * is what turns a screenshot of an error into a log query.
 */
export const metaSchema = z.object({
  requestId: z.string(),
  /** List endpoints only. */
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  total: z.number().int().optional(),
});
export type Meta = z.infer<typeof metaSchema>;

/**
 * The key `fieldErrors` uses for problems that belong to the request as a whole
 * rather than one input — the API writes it, a form shows it as a summary.
 */
export const FORM_LEVEL_FIELD = '_';

/**
 * `fieldErrors` is keyed by form field name and feeds react-hook-form directly.
 * `details` is free-form context for the client (never internals — see the
 * exception filter).
 */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiFailureSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
  meta: metaSchema,
});
export type ApiFailure = z.infer<typeof apiFailureSchema>;

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: Meta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/** Builds the success schema for one payload type — used to validate responses. */
export function apiSuccessSchema<T extends ZodType>(
  data: T,
): z.ZodObject<{ success: z.ZodLiteral<true>; data: T; meta: typeof metaSchema }> {
  return z.object({ success: z.literal(true), data, meta: metaSchema });
}

// ============================================================================
// Pagination
//
// A list handler returns this shape and the interceptor splits it: `items`
// becomes `data`, the counts become `meta`. The client reassembles it, so both
// ends speak in whole pages and only the wire format is split.
// ============================================================================

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** True for the exact list shape the interceptor unpacks. */
export function isPaginated(value: unknown): value is Paginated<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.page === 'number' &&
    typeof candidate.pageSize === 'number' &&
    typeof candidate.total === 'number'
  );
}

// ============================================================================
// AppException — thrown on the server, rebuilt on the client
// ============================================================================

/** Survives bundling and duplicate module copies, which `instanceof` may not. */
const APP_EXCEPTION_BRAND = Symbol.for('iace.AppException');

export interface AppExceptionOptions {
  fieldErrors?: Record<string, string[]>;
  details?: unknown;
  /** Overrides the code's default status. Rarely needed. */
  httpStatus?: number;
  /** Server-side only: the underlying error, for logs. Never serialised. */
  cause?: unknown;
}

/**
 * The one thing the API throws for an expected failure, and the one thing the
 * client throws when a response comes back `success: false`. Both sides then
 * branch on `.code`.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: unknown;
  /** @internal */
  readonly [APP_EXCEPTION_BRAND] = true;

  constructor(code: ErrorCode, message?: string, options: AppExceptionOptions = {}) {
    super(message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.name = 'AppException';
    this.code = code;
    this.httpStatus = options.httpStatus ?? ERROR_CODE_STATUS[code];
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
    if (options.details !== undefined) this.details = options.details;
  }

  /** Use instead of `instanceof` — correct even across module copies. */
  static is(value: unknown): value is AppException {
    return (
      typeof value === 'object' &&
      value !== null &&
      APP_EXCEPTION_BRAND in value &&
      (value as Record<symbol, unknown>)[APP_EXCEPTION_BRAND] === true
    );
  }

  /** Rebuilds the server's error on the client, code and all. */
  static fromFailure(failure: ApiFailure, httpStatus?: number): AppException {
    const { code, message, fieldErrors, details } = failure.error;
    return new AppException(code, message, { fieldErrors, details, httpStatus });
  }

  /** The wire form — exactly the `error` half of an ApiFailure. */
  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

// ============================================================================
// Status ↔ code
// ============================================================================

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: ErrorCodes.VALIDATION_ERROR,
  401: ErrorCodes.UNAUTHENTICATED,
  403: ErrorCodes.FORBIDDEN,
  404: ErrorCodes.NOT_FOUND,
  409: ErrorCodes.CONFLICT,
  429: ErrorCodes.RATE_LIMITED,
};

/**
 * For errors that arrive as a bare status with no envelope — a framework 404, a
 * gateway 502, a proxy that never reached us. Anything 5xx is INTERNAL; any
 * other unmapped 4xx means the request itself was unacceptable.
 */
export function errorCodeForStatus(status: number): ErrorCode {
  return (
    STATUS_TO_CODE[status] ?? (status >= 500 ? ErrorCodes.INTERNAL : ErrorCodes.VALIDATION_ERROR)
  );
}
