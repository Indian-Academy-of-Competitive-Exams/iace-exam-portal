import { type ZodType } from 'zod';
import { CSV_SEPARATOR } from '../common';
import {
  AppException,
  ErrorCodes,
  apiFailureSchema,
  apiSuccessSchema,
  errorCodeForStatus,
  REQUEST_ID_HEADER,
  type ApiSuccess,
  type Paginated,
} from '../envelope';
import { AUTH_ROUTES, authTokensSchema, type AuthTokens } from '../auth';

/** Drops empty and undefined keys, so an unset filter never becomes `?q=undefined`. */
export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    // An empty set is "don't care": sent, the server would read it as `in: []` and match nothing.
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(CSV_SEPARATOR));
      continue;
    }
    // Primitives only, each named — an object would become "[object Object]" in the URL, a filter nobody can read.
    if (typeof value === 'string') search.set(key, value);
    else if (typeof value === 'number' || typeof value === 'boolean') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
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
  onUnauthorized?: (cause?: AppException) => void;
  /** Sent on every request, e.g. which app this is. */
  headers?: Readonly<Record<string, string>>;
  fetchImpl?: typeof fetch;
}

export type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<T> {
  method?: 'GET' | WriteMethod;
  body?: unknown;
  schema: ZodType<T>;
  /** Skip the Authorization header and the refresh-on-401 dance. */
  anonymous?: boolean;
}

/** Callers never see the envelope: every method returns `data` or throws an `AppException`. */
export function createApiCore(options: ApiClientOptions) {
  const {
    baseUrl,
    getAccessToken,
    getRefreshToken,
    onTokensRefreshed,
    onUnauthorized,
    headers = {},
    fetchImpl = globalThis.fetch,
  } = options;

  const url = (path: string) => `${baseUrl.replace(/\/$/, '')}${path}`;

  /** Single-flight guard: many parallel 401s trigger exactly one refresh call. */
  let refreshInFlight: Promise<AuthTokens | null> | null = null;
  /** The AppException from the last failed refresh, so `onUnauthorized` can say why. */
  let refreshFailure: AppException | undefined;

  async function send(path: string, method: string, body: unknown, token: string | null) {
    // FormData: the browser must set its own Content-Type, boundary included.
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    try {
      return await fetchImpl(url(path), {
        method,
        headers: {
          ...headers,
          ...(body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) }),
      });
    } catch (cause) {
      // The request never landed — offline, DNS, CORS, a dead API; same typed error as everything else, so callers need no second code path.
      throw new AppException(
        ErrorCodes.INTERNAL,
        'Cannot reach the server. Check your connection.',
        {
          httpStatus: 0,
          cause,
        },
      );
    }
  }

  /** Both halves are validated: an unrecognised shape must never reach a caller typed as data. */
  async function parse<T>(response: Response, schema: ZodType<T>): Promise<ApiSuccess<T>> {
    if (response.status === NO_CONTENT) return noContentOf(response, schema);
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
      // A non-2xx that is not our envelope came from something in front of the API — a proxy, gateway, or framework default we don't control.
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
      throw new AppException(ErrorCodes.INTERNAL, 'Unexpected response shape from API', {
        httpStatus: response.status,
        details: success.error.issues,
      });
    }
    return success.data as ApiSuccess<T>;
  }

  async function refreshTokens(): Promise<AuthTokens | null> {
    refreshFailure = undefined;
    const refreshToken = getRefreshToken();
    if (!refreshToken) return null;

    for (let asked = 0; ; asked += 1) {
      try {
        const envelope = await parse(
          await send(AUTH_ROUTES.refresh, 'POST', { refreshToken }, null),
          authTokensSchema,
        );
        onTokensRefreshed?.(envelope.data);
        return envelope.data;
      } catch (error) {
        // Refresh being REFUSED is a normal end-of-session; anything else is asked again below.
        refreshFailure = AppException.is(error) ? error : undefined;
        const backoff = worthAskingAgain(refreshFailure) ? refreshBackoffMs(asked) : undefined;
        if (backoff === undefined) return null;
        await new Promise((wake) => setTimeout(wake, backoff));
      }
    }
  }

  /** A refusal ends it, and so does having nothing to refresh with. A failure we could not reach does not. */
  const sessionIsOver = (): boolean =>
    getRefreshToken() === null || !worthAskingAgain(refreshFailure);

  async function envelopeOf<T>(path: string, opts: RequestOptions<T>): Promise<ApiSuccess<T>> {
    const { method = 'GET', body, schema, anonymous = false } = opts;

    if (anonymous) return parse(await send(path, method, body, null), schema);

    const response = await send(path, method, body, getAccessToken());
    if (response.status !== 401) return parse(response, schema);

    const peeked = await peekFailure(response);

    // A replaced session is over for good; refreshing would only be refused the same way.
    if (peeked?.error.code === ErrorCodes.SESSION_REPLACED) {
      const replaced = AppException.fromFailure(peeked, response.status);
      onUnauthorized?.(replaced);
      throw replaced;
    }

    // Only an expired session is worth retrying: refreshing on a wrong PIN hides the real code.
    if (peeked && peeked.error.code !== 'UNAUTHENTICATED') {
      throw AppException.fromFailure(peeked, response.status);
    }

    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });
    const refreshed = await refreshInFlight;

    if (!refreshed) {
      if (sessionIsOver()) onUnauthorized?.(refreshFailure);
      throw endedBy(refreshFailure, peeked);
    }

    const retried = await send(path, method, body, refreshed.accessToken);
    if (retried.status === 401) onUnauthorized?.(await failureOf(retried));
    return parse(retried, schema);
  }

  /** The everyday call: returns `data`, throws `AppException`. */
  async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
    return (await envelopeOf(path, opts)).data;
  }

  /** Recombines `data` with the pagination from `meta`, so callers get one page object. */
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

  /** A binary download, authenticated and refresh-aware; it cannot go through `parse` since reading the body as text would corrupt the file, but a FAILURE is still an envelope. */
  async function requestBlob(path: string, query: Record<string, unknown> = {}): Promise<Blob> {
    const url = `${path}${queryString(query)}`;
    let response = await send(url, 'GET', undefined, getAccessToken());

    if (response.status === 401) {
      const refreshed = await refreshTokens();
      if (!refreshed) {
        if (sessionIsOver()) onUnauthorized?.();
        throw endedBy(refreshFailure, await peekFailure(response));
      }
      response = await send(url, 'GET', undefined, refreshed.accessToken);
    }

    if (!response.ok) {
      const failure = await peekFailure(response);
      throw new AppException(
        failure?.error.code ?? errorCodeForStatus(response.status),
        failure?.error.message ?? 'That file could not be downloaded',
        { httpStatus: response.status },
      );
    }

    return response.blob();
  }

  const get = <T>(path: string, schema: ZodType<T>) => request(path, { schema });
  const write = <T>(method: WriteMethod, path: string, schema: ZodType<T>, body?: unknown) =>
    request(path, { method, body, schema });
  const list = <T>(path: string, query: object, schema: ZodType<T>) =>
    requestPaginated(`${path}${queryString({ ...query })}`, { schema: schema.array() });

  return { request, requestPaginated, requestBlob, get, write, list };
}

/** The shared transport every domain group calls through, never the schemas it carries. */
export type ApiCore = ReturnType<typeof createApiCore>;

/** Reads a failure body. Outside the factory because it closes over nothing. */
const NO_CONTENT = 204;

/** The only answer that ends a session. A throttle, a 5xx or a dropped packet says nothing about it. */
const REFUSED = 401;

/** Halved and jittered: a hall whose tokens expired in the same minute must not ask again in step. */
const REFRESH_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

function refreshBackoffMs(asked: number, random: () => number = Math.random): number | undefined {
  const step = REFRESH_BACKOFF_MS[asked];
  return step === undefined ? undefined : step / 2 + random() * step;
}

function worthAskingAgain(failure: AppException | undefined): boolean {
  return failure?.httpStatus !== REFUSED;
}

/** A 204 never has a body (Express drops one), so it can only mean null; a schema that refuses null is a real mismatch. */
function noContentOf<T>(response: Response, schema: ZodType<T>): ApiSuccess<T> {
  const data = schema.safeParse(null);
  if (!data.success) {
    throw new AppException(ErrorCodes.INTERNAL, 'Unexpected response shape from API', {
      httpStatus: response.status,
      details: data.error.issues,
    });
  }
  return {
    success: true,
    data: data.data,
    meta: { requestId: response.headers.get(REQUEST_ID_HEADER) ?? '' },
  };
}

/** The typed failure a 401 carried, so a sign-out can say why. */
async function failureOf(response: Response): Promise<AppException | undefined> {
  const failed = await peekFailure(response);
  return failed ? AppException.fromFailure(failed, response.status) : undefined;
}

/** Why a request is over: a replacement names itself, else the 401 that sent it to refresh. */
function endedBy(
  refreshFailure: AppException | undefined,
  peeked: Awaited<ReturnType<typeof peekFailure>>,
): AppException {
  if (refreshFailure?.code === ErrorCodes.SESSION_REPLACED) return refreshFailure;
  // Never refused, only unreachable: say what actually went wrong rather than "sign in again".
  if (refreshFailure && worthAskingAgain(refreshFailure)) return refreshFailure;
  if (peeked) return AppException.fromFailure(peeked, 401);
  return new AppException(ErrorCodes.UNAUTHENTICATED, undefined, { httpStatus: 401 });
}

async function peekFailure(response: Response) {
  try {
    const parsed = apiFailureSchema.safeParse(await response.clone().json());
    return parsed.success ? parsed.data : null;
  } catch {
    // A body that is not JSON at all is simply not an envelope.
    return null;
  }
}
