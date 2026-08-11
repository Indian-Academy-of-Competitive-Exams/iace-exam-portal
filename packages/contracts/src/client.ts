import { type ZodType } from 'zod';
import { apiErrorSchema } from './common';
import {
  AUTH_ROUTES,
  authSessionResponseSchema,
  authIdentitySchema,
  authTokensSchema,
  logoutResponseSchema,
  otpRequestResponseSchema,
  pinSetupTicketSchema,
  type AuthIdentity,
  type AuthSessionResponse,
  type AuthTokens,
  type LogoutResponse,
  type OtpRequestResponse,
  type PinSetupTicket,
  type RequestAdminOtpInput,
  type RequestStudentOtpInput,
  type SetStudentPinInput,
  type StudentLoginInput,
  type VerifyAdminOtpInput,
  type VerifyStudentOtpInput,
} from './auth';
import { healthResponseSchema, type HealthResponse } from './health';

/** Thrown for any non-2xx response. Carries the parsed NestJS error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const parsed = apiErrorSchema.safeParse(body);
    if (!parsed.success) return new ApiError(status, `Request failed (${status})`, body);
    const { message } = parsed.data;
    return new ApiError(status, Array.isArray(message) ? message.join(', ') : message, body);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Current access token, or null when signed out. */
  getAccessToken: () => string | null;
  /** Current refresh token, or null when signed out. */
  getRefreshToken: () => string | null;
  /** Called after a successful silent refresh so the caller can persist rotation. */
  onTokensRefreshed?: (tokens: AuthTokens) => void;
  /** Called when the session is unrecoverable — the caller should sign out. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema: ZodType<T>;
  /** Skip the Authorization header and the refresh-on-401 dance. */
  anonymous?: boolean;
}

export function createApiClient(options: ApiClientOptions) {
  const {
    baseUrl,
    getAccessToken,
    getRefreshToken,
    onTokensRefreshed,
    onUnauthorized,
    fetchImpl = globalThis.fetch,
  } = options;

  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

  /** Single-flight guard: many parallel 401s trigger exactly one refresh call. */
  let refreshInFlight: Promise<AuthTokens | null> | null = null;

  async function send(path: string, method: string, body: unknown, token: string | null) {
    return fetchImpl(url(path), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function parse<T>(response: Response, schema: ZodType<T>): Promise<T> {
    const text = await response.text();
    const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;
    if (!response.ok) throw ApiError.fromBody(response.status, payload);

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError(response.status, 'Unexpected response shape from API', parsed.error);
    }
    return parsed.data;
  }

  async function refreshTokens(): Promise<AuthTokens | null> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    const response = await send(AUTH_ROUTES.refresh, 'POST', { refreshToken }, null);
    if (!response.ok) return null;

    const tokens = authTokensSchema.safeParse(await response.json());
    if (!tokens.success) return null;

    onTokensRefreshed?.(tokens.data);
    return tokens.data;
  }

  async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
    const { method = 'GET', body, schema, anonymous = false } = opts;

    if (anonymous) return parse(await send(path, method, body, null), schema);

    let response = await send(path, method, body, getAccessToken());
    if (response.status !== 401) return parse(response, schema);

    // Access token expired — refresh once, then replay the original request.
    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      onUnauthorized?.();
      return parse(response, schema);
    }

    response = await send(path, method, body, refreshed.accessToken);
    if (response.status === 401) onUnauthorized?.();
    return parse(response, schema);
  }

  return {
    request,

    health: (): Promise<HealthResponse> =>
      request('/health', { schema: healthResponseSchema, anonymous: true }),

    auth: {
      /** Student signup or PIN reset, step 1. */
      requestStudentOtp: (input: RequestStudentOtpInput): Promise<OtpRequestResponse> =>
        request(AUTH_ROUTES.studentOtpRequest, {
          method: 'POST',
          body: input,
          schema: otpRequestResponseSchema,
          anonymous: true,
        }),

      /** Step 2 — proves the number and returns a ticket, not a session. */
      verifyStudentOtp: (input: VerifyStudentOtpInput): Promise<PinSetupTicket> =>
        request(AUTH_ROUTES.studentOtpVerify, {
          method: 'POST',
          body: input,
          schema: pinSetupTicketSchema,
          anonymous: true,
        }),

      /** Step 3 — redeems the ticket, stores the PIN and signs the student in. */
      setStudentPin: (input: SetStudentPinInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.studentPinSet, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      /** The everyday student login: mobile + 6-digit PIN, no OTP. */
      loginStudent: (input: StudentLoginInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.studentLogin, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      requestAdminOtp: (input: RequestAdminOtpInput): Promise<OtpRequestResponse> =>
        request(AUTH_ROUTES.adminOtpRequest, {
          method: 'POST',
          body: input,
          schema: otpRequestResponseSchema,
          anonymous: true,
        }),

      verifyAdminOtp: (input: VerifyAdminOtpInput): Promise<AuthSessionResponse> =>
        request(AUTH_ROUTES.adminOtpVerify, {
          method: 'POST',
          body: input,
          schema: authSessionResponseSchema,
          anonymous: true,
        }),

      me: (): Promise<AuthIdentity> => request(AUTH_ROUTES.me, { schema: authIdentitySchema }),

      logout: (): Promise<LogoutResponse> =>
        request(AUTH_ROUTES.logout, { method: 'POST', schema: logoutResponseSchema }),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
