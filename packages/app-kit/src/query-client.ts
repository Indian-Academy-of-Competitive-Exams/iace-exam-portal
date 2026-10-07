import { MutationCache, QueryCache, QueryClient, type Mutation } from '@tanstack/react-query';
import { AppException, ErrorCodes } from '@iace/contracts';
import { bannerMessage } from './form-errors';

/** A replaced session is said once, on the sign-in screen, not by every request it cut short. */
const isReplaced = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.SESSION_REPLACED;

/** A refusal is the server's answer; a throttle, a server fault or a request that never landed is not. */
export function isWorthAskingAgain(error: unknown): boolean {
  if (!AppException.is(error)) return true;
  const { httpStatus } = error;
  return httpStatus === 0 || httpStatus === THROTTLED || httpStatus >= SERVER_FAULT;
}

/** The default for every read: once more, and only for what a refusal did not answer. */
export const shouldRetryRead = (failures: number, error: unknown): boolean =>
  failures < 1 && isWorthAskingAgain(error);

const THROTTLED = 429;
const SERVER_FAULT = 500;
const RETRY_BASE_MS = 1_000;

/** Doubling, with a full base of jitter: a fixed delay brings 6K clients back to a failed read in lockstep. */
export function retryDelayMs(failures: number, random: () => number = Math.random): number {
  return Math.round(RETRY_BASE_MS * 2 ** failures * (1 + random()));
}

/** What a query may declare. `silent` opts out of the central reporting, or only for the failures its screen draws itself. */
export interface AppQueryMeta {
  silent?: boolean | ((error: unknown) => boolean);
}

export interface AppMutationMeta {
  /** Announced when it succeeds. Omit for mutations nobody needs told about. */
  success?: string | ((data: unknown) => string);
  /** Fields this form owns. A failure landing entirely on them is not also toasted. */
  fields?: readonly string[];
  /** Opt out entirely: the screen handles its own reporting. */
  silent?: boolean;
}

/** The fetching policy every SPA runs on: retry what a refusal did not answer once, no refetch on focus — students sit timed tests on flaky mobile; also catches every mutation failure in one place. */
export function createAppQueryClient(options: { notify?: Notifier } = {}): QueryClient {
  const { notify } = options;

  return new QueryClient({
    /** Failed reads are announced here too, once, after the retries are exhausted. */
    queryCache: new QueryCache({
      onError: (error, query) => {
        const { silent } = (query.meta ?? {}) as AppQueryMeta;
        const quiet = typeof silent === 'function' ? silent(error) : silent;
        if (!notify || quiet || isReplaced(error)) return;

        const message = bannerMessage(error);
        if (message) notify.error(message);
      },
    }),

    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const meta = metaOf(mutation);
        if (!notify || meta.silent || isReplaced(error)) return;

        // Null when every message is already on a field — see bannerMessage.
        const message = bannerMessage(error, meta.fields ?? []);
        if (message) notify.error(message);
      },

      onSuccess: (data, _variables, _context, mutation) => {
        const meta = metaOf(mutation);
        if (!notify || meta.silent || !meta.success) return;

        notify.success(typeof meta.success === 'function' ? meta.success(data) : meta.success);
      },
    }),

    defaultOptions: {
      queries: {
        retry: shouldRetryRead,
        retryDelay: (failures) => retryDelayMs(failures),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** What the client needs to announce something. Kept tiny so @iace/ui owns the look. */
export interface Notifier {
  success: (message: string) => void;
  error: (message: string) => void;
}

function metaOf(
  mutation: Mutation<unknown, unknown, unknown, unknown> | undefined,
): AppMutationMeta {
  return (mutation?.options.meta ?? {}) as AppMutationMeta;
}
