import { type ZodType } from 'zod';
import {
  AppException,
  apiFailureSchema,
  apiSuccessSchema,
  errorCodeForStatus,
  type ApiSuccess,
  type Paginated,
} from './envelope';
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

/**
 * The client half of the response envelope. Callers never see it: every method
 * returns unwrapped `data`, or throws an `AppException` carrying the server's
 * `code`, `message` and `fieldErrors`. React Query therefore has exactly one
 * error type to handle, everywhere.
 */
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
    try {
      return await fetchImpl(url(path), {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // The request never landed — offline, DNS, CORS, a dead API. Same typed
      // error as everything else, so callers need no second code path.
      throw new AppException('INTERNAL', 'Cannot reach the server. Check your connection.', {
        httpStatus: 0,
        cause,
      });
    }
  }

  /**
   * Turns a response into either the parsed success envelope or a throw. Both
   * halves of the envelope are validated: a body that is neither is itself a
   * failure, because an unrecognised shape must never reach a caller typed as
   * if it were data.
   */
  async function parse<T>(response: Response, schema: ZodType<T>): Promise<ApiSuccess<T>> {
    const text = await response.text();

    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      throw new AppException(
        errorCodeForStatus(response.status),
        'The server sent a malformed response',
        {
          httpStatus: response.status,
        },
      );
    }

    const failure = apiFailureSchema.safeParse(payload);
    if (failure.success) throw AppException.fromFailure(failure.data, response.status);

    if (!response.ok) {
      // A non-2xx that is not our envelope came from something in front of the
      // API — a proxy, a gateway, a framework default we do not control.
      throw new AppException(
        errorCodeForStatus(response.status),
        `Request failed (${response.status})`,
        {
          httpStatus: response.status,
        },
      );
    }

    const success = apiSuccessSchema(schema).safeParse(payload);
    if (!success.success) {
      throw new AppException('INTERNAL', 'Unexpected response shape from API', {
        httpStatus: response.status,
        details: success.error.issues,
      });
    }
    return success.data as ApiSuccess<T>;
  }

  async function refreshTokens(): Promise<AuthTokens | null> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    try {
      const envelope = await parse(
        await send(AUTH_ROUTES.refresh, 'POST', { refreshToken }, null),
        authTokensSchema,
      );
      onTokensRefreshed?.(envelope.data);
      return envelope.data;
    } catch {
      // Refresh failing is a normal end-of-session, not an error to propagate.
      return null;
    }
  }

  async function envelopeOf<T>(path: string, opts: RequestOptions<T>): Promise<ApiSuccess<T>> {
    const { method = 'GET', body, schema, anonymous = false } = opts;

    if (anonymous) return parse(await send(path, method, body, null), schema);

    const response = await send(path, method, body, getAccessToken());
    if (response.status !== 401) return parse(response, schema);

    // Only an expired/absent session is worth retrying. A 401 that means
    // "wrong PIN" or "bad OTP" must surface as itself — refreshing would hide
    // the real code and, worse, could sign a valid session out.
    const peeked = await peekFailure(response);
    if (peeked && peeked.error.code !== 'UNAUTHENTICATED') {
      throw AppException.fromFailure(peeked, response.status);
    }

    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      onUnauthorized?.();
      throw peeked
        ? AppException.fromFailure(peeked, 401)
        : new AppException('UNAUTHENTICATED', undefined, { httpStatus: 401 });
    }

    const retried = await send(path, method, body, refreshed.accessToken);
    if (retried.status === 401) onUnauthorized?.();
    return parse(retried, schema);
  }

  /** Reads a failure body without consuming the caller's error path. */
  async function peekFailure(response: Response) {
    try {
      const parsed = apiFailureSchema.safeParse(await response.clone().json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** The everyday call: returns `data`, throws `AppException`. */
  async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
    return (await envelopeOf(path, opts)).data;
  }

  /**
   * For list endpoints: recombines `data` with the pagination that travels in
   * `meta`, so callers work with one whole page object.
   */
  async function requestPaginated<T>(
    path: string,
    opts: RequestOptions<T[]>,
  ): Promise<Paginated<T>> {
    const { data, meta } = await envelopeOf(path, opts);
    return {
      items: data,
      page: meta.page ?? 1,
      pageSize: meta.pageSize ?? data.length,
      total: meta.total ?? data.length,
    };
  }

  return {
    request,
    requestPaginated,

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
