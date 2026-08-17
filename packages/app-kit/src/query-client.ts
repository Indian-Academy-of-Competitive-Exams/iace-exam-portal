import { MutationCache, QueryCache, QueryClient, type Mutation } from '@tanstack/react-query';
import { bannerMessage } from './form-errors';

/** What a mutation declares about itself, for the central handler below. */
/** What a query may declare. `silent` opts out of the central reporting. */
export interface AppQueryMeta {
  silent?: boolean;
}

export interface AppMutationMeta {
  /** Announced when it succeeds. Omit for mutations nobody needs told about. */
  success?: string | ((data: unknown) => string);
  /** Fields this form owns. A failure landing entirely on them is not also toasted. */
  fields?: readonly string[];
  /** Opt out entirely: the screen handles its own reporting. */
  silent?: boolean;
}

/**
 * The fetching policy every SPA runs on: retry once, no refetch on focus — students
 * sit timed tests on flaky mobile. Also catches every mutation failure in one place.
 */
export function createAppQueryClient(options: { notify?: Notifier } = {}): QueryClient {
  const { notify } = options;

  return new QueryClient({
    /** Failed reads are announced here too, once, after the retries are exhausted. */
    queryCache: new QueryCache({
      onError: (error, query) => {
        const meta = (query.meta ?? {}) as AppQueryMeta;
        if (!notify || meta.silent) return;

        const message = bannerMessage(error);
        if (message) notify.error(message);
      },
    }),

    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const meta = metaOf(mutation);
        if (!notify || meta.silent) return;

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
        retry: 1,
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
