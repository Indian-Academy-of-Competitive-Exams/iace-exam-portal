import { MutationCache, QueryCache, QueryClient, type Mutation } from '@tanstack/react-query';
import { bannerMessage } from './form-errors';

/**
 * What a mutation may declare about itself, for the central handler below.
 *
 * `success` is a string rather than a boolean because the message is the point:
 * "Saved" and "Added 12 students to SSC CGL MORNING" are both confirmations and
 * only one of them is worth reading.
 */
/** What a query may declare. `silent` opts out of the central reporting. */
export interface AppQueryMeta {
  silent?: boolean;
}

export interface AppMutationMeta {
  /** Announced when it succeeds. Omit for mutations nobody needs told about. */
  success?: string | ((data: unknown) => string);
  /**
   * Fields this mutation's form owns. A failure whose messages ALL land on
   * those fields is not announced — the inputs already say it, and a toast
   * repeating it makes the reader look in two places.
   */
  fields?: readonly string[];
  /** Opt out entirely: the screen handles its own reporting. */
  silent?: boolean;
}

/**
 * The fetching policy every IACE SPA runs on.
 *
 * These are not per-app preferences, they are one judgement about the network
 * the platform lives on: students sit live timed tests over flaky mobile
 * connections, where a request worth retrying is worth retrying ONCE and a
 * client that hammers is worse than one that fails visibly. Refetch-on-focus is
 * off for the same reason — a student tabbing back mid-test should not trigger
 * a burst of requests.
 *
 * It also catches EVERY mutation failure in one place. Without this, each form
 * grows its own error banner, they drift, and the one that was forgotten fails
 * in silence — which is the failure nobody reports because it looks like
 * nothing happened.
 */
export function createAppQueryClient(options: { notify?: Notifier } = {}): QueryClient {
  const { notify } = options;

  return new QueryClient({
    /**
     * Reads that fail are announced here too, so NOTHING is left to a component
     * to report. It fires once, after the retry below is exhausted — not on
     * every attempt — and a screen whose data did not arrive still shows a
     * neutral "could not load" in place of its content, because a toast that
     * fades leaves a blank page behind it.
     */
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
