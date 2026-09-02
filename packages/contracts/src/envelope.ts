import { z, type ZodType } from 'zod';

// ============================================================================
// The one response envelope.
//   success  { success: true,  data, meta }
//   failure  { success: false, error: { code, message, fieldErrors? }, meta }
// An interceptor wraps returns and one exception filter maps every throw, so a
// controller cannot emit another shape. React to `error.code`, never to `message`.
// ============================================================================

/**
 * The stable error vocabulary. Add to it; never repurpose a member.
 * Throw with the constant — `AppException(ErrorCodes.PIN_LOCKED, …)`, never the bare string.
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
  ADMIN_NOT_REGISTERED: 'ADMIN_NOT_REGISTERED',
  DRAW_SHORTFALL: 'DRAW_SHORTFALL',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const errorCodeSchema = z.enum(ErrorCodes);

/** The status each code answers with — right for proxies and caches, even though callers use the code. */
export const ERROR_CODE_STATUS: Record<ErrorCode, number> = {
  [ErrorCodes.VALIDATION_ERROR]: 400,
  [ErrorCodes.UNAUTHENTICATED]: 401,
  [ErrorCodes.FORBIDDEN]: 403,
  [ErrorCodes.NOT_FOUND]: 404,
  [ErrorCodes.CONFLICT]: 409,
  [ErrorCodes.RATE_LIMITED]: 429,
  // A wrong or stale credential is an authentication failure, not a malformed
  // request — the body was perfectly well-formed.
  [ErrorCodes.ADMIN_NOT_REGISTERED]: 404,
  [ErrorCodes.OTP_INVALID]: 401,
  [ErrorCodes.OTP_EXPIRED]: 401,
  [ErrorCodes.PIN_INVALID]: 401,
  // Locked is a throttle, and 429 is what tells a client to back off.
  [ErrorCodes.PIN_LOCKED]: 429,
  // The request was fine; the bank simply does not hold enough to build the paper it asked for.
  [ErrorCodes.DRAW_SHORTFALL]: 422,
  // A dependency is down, not the request: 503 is what tells a load balancer to send this elsewhere.
  [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
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
  [ErrorCodes.ADMIN_NOT_REGISTERED]:
    'That email has no admin account. Ask a super admin to create one for you.',
  [ErrorCodes.DRAW_SHORTFALL]:
    'The question bank does not hold enough questions to fill every section of this paper.',
  [ErrorCodes.SERVICE_UNAVAILABLE]: 'The service is not ready. Please try again in a moment.',
  [ErrorCodes.INTERNAL]: 'Something went wrong. Please try again.',
};

// ============================================================================
// Shapes
// ============================================================================

/** On every response. `requestId` is echoed in the header and the log line for the same request. */
export const metaSchema = z.object({
  requestId: z.string(),
  /** List endpoints only. */
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  total: z.number().int().optional(),
});
export type Meta = z.infer<typeof metaSchema>;

/** The `fieldErrors` key for problems belonging to the whole request rather than one input. */
export const FORM_LEVEL_FIELD = '_';

/** `fieldErrors` feeds react-hook-form directly. `details` is client context, never internals. */
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

/** For endpoints whose whole answer is "it worked" — the payload is `null`. */
export const noContentSchema = z.null();
export type NoContent = z.infer<typeof noContentSchema>;

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: Meta;
}

/** Builds the success schema for one payload type — used to validate responses. */
export function apiSuccessSchema<T extends ZodType>(
  data: T,
): z.ZodObject<{ success: z.ZodLiteral<true>; data: T; meta: typeof metaSchema }> {
  return z.object({ success: z.literal(true), data, meta: metaSchema });
}

// ============================================================================
// Pagination. A handler returns this; the interceptor splits `items` into `data`
// and the counts into `meta`, and the client reassembles it.
// ============================================================================

/** Defaults every list endpoint shares, so paging behaves the same everywhere. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/** The sizes a list offers, declared beside the cap so an option cannot exceed it. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

/** True for a value this app is willing to page by. */
export function isPageSizeOption(value: unknown): value is PageSizeOption {
  return PAGE_SIZE_OPTIONS.includes(value as PageSizeOption);
}

/** `pageSize` is capped, not trusted: uncapped, any list pulls the whole table. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;

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

/** Thrown by the API for an expected failure and by the client on `success: false`. */
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

/** For a bare status with no envelope — a framework 404, a gateway 502. 5xx is INTERNAL. */
export function errorCodeForStatus(status: number): ErrorCode {
  return (
    STATUS_TO_CODE[status] ?? (status >= 500 ? ErrorCodes.INTERNAL : ErrorCodes.VALIDATION_ERROR)
  );
}
