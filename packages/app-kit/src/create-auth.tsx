import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type AuthIdentity, type AuthSessionResponse } from '@iace/contracts';
import { isWorthAskingAgain } from './query-client';
import { type TokenStore } from './token-store';
import { type SignOutReason, type SignOutSignal } from './sign-out-signal';

/** The session as a screen sees it; `identity` is null with no token, a dead token, or a token for the wrong actor. */
export interface AuthState<TIdentity> {
  identity: TIdentity | null;
  isLoading: boolean;
  /** A token is held but the server never said whose: not signed out, so a screen offers `retry`, not sign-in. */
  isUnreachable: boolean;
  retry: () => void;
  signIn: (session: AuthSessionResponse) => void;
  signOut: () => Promise<void>;
  signedOutReason: SignOutReason | null;
}

/** What the factory needs to know about an app. Everything else is identical. */
export interface CreateAuthOptions<TIdentity extends AuthIdentity, TExtra extends object> {
  /** The one actor type this app accepts. Anything else is not a session here. */
  actor: TIdentity['actor'];
  /** React Query key for the identity. Per app, since each has its own cache. */
  queryKey: QueryKey;
  tokenStore: TokenStore;
  signOutSignal: SignOutSignal;
  /** The two endpoints a session needs, taken from the app's typed client. */
  endpoints: {
    me: () => Promise<AuthIdentity>;
    logout: () => Promise<void>;
  };
  /** App-specific reads over the identity, merged into the context value. */
  extend?: (identity: TIdentity | null) => TExtra;
  /** Runs on every sign-in. */
  onSignedIn?: () => void;
}

const ME_RETRIES = 1;
const ME_RETRY_BASE_MS = 1000;

/** One to two seconds, drawn per student, as the autosave spreads its own. */
function meRetryDelayMs(random: () => number = Math.random): number {
  return ME_RETRY_BASE_MS * (1 + random());
}

/** How long a sign-out waits on a best-effort call before this device is cleared regardless. */
export const SIGN_OUT_WAIT_MS = 4_000;

/** Settles when `work` does or the wait runs out, whichever is first, and never rejects: what follows goes ahead either way. */
export function settledWithin(work: Promise<unknown>, waitMs: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, waitMs);
    const settled = () => {
      clearTimeout(timer);
      done();
    };
    work.then(settled, settled);
  });
}

/** One session implementation for every SPA, parameterised by the identity type. */
export function createAuth<TIdentity extends AuthIdentity, TExtra extends object = object>(
  options: CreateAuthOptions<TIdentity, TExtra>,
): {
  AuthProvider: (props: Readonly<{ children: ReactNode }>) => ReactNode;
  useAuth: () => AuthState<TIdentity> & TExtra;
} {
  const { actor, queryKey, tokenStore, signOutSignal, endpoints, extend, onSignedIn } = options;

  const AuthContext = createContext<(AuthState<TIdentity> & TExtra) | null>(null);

  function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
    const queryClient = useQueryClient();

    /** Whether a token exists, in React state — the store is outside React, so writing to it notifies nothing that renders. */
    const [hasToken, setHasToken] = useState(() => tokenStore.get() !== null);
    const [signedOutReason, setSignedOutReason] = useState<SignOutReason | null>(
      () => tokenStore.endedBy?.() ?? null,
    );
    /** How many times another tab has put a different person under this one; each remounts every screen. */
    const [swaps, setSwaps] = useState(0);

    // /auth/me re-reads the identity, so a permission change lands on reload.
    const { data, isLoading, isPaused, error, refetch } = useQuery({
      queryKey,
      queryFn: () => endpoints.me(),
      enabled: hasToken,
      // A blip at boot must not send a good token to the sign-in screen; a refusal already ended the session.
      retry: (failures, error) => failures < ME_RETRIES && isWorthAskingAgain(error),
      // Once, and spread: the refresh under it already backed off, and a hall must not ask in step.
      retryDelay: () => meRetryDelayMs(),
      staleTime: 5 * 60 * 1000,
    });

    /** What this tab shows and holds in memory; the store is left alone, for when another tab emptied it. */
    const forget = useCallback(() => {
      setHasToken(false);
      // All of it, not just the identity: the next person on a shared machine must not see this one's data.
      queryClient.clear();
    }, [queryClient]);

    const clearSession = useCallback(() => {
      tokenStore.clear();
      forget();
    }, [forget]);

    /** Takes up the token another tab stored: a renewed one is the same person, and only the server can say it is someone else. */
    const adopt = useCallback(async () => {
      setSignedOutReason(null);
      setHasToken(true);
      if (queryClient.getQueryData(queryKey) === undefined) return void refetch();
      // Unanswered, nothing changes: the next write heard asks again.
      const now = await endpoints.me().catch(() => null);
      // Read after the answer, not before asking: a second write heard meanwhile must not remount twice.
      const shown = queryClient.getQueryData<AuthIdentity>(queryKey);
      if (!now || !shown || shown.id === now.id) return;
      queryClient.clear();
      queryClient.setQueryData(queryKey, now);
      setSwaps((count) => count + 1);
    }, [queryClient, refetch]);

    // Another tab wrote the store: show what it holds now, and never write back, which would end that tab's session.
    useEffect(
      () =>
        tokenStore.subscribe?.(() => {
          if (tokenStore.get() !== null) return void adopt();
          // The tab the server told left why beside the emptied key, for the ones it did not.
          const reason = tokenStore.endedBy?.();
          if (reason) setSignedOutReason(reason);
          forget();
        }),
      [forget, adopt],
    );

    // Raised by the API client when a refresh fails — the session is unrecoverable and nothing else notices.
    useEffect(
      () =>
        signOutSignal.subscribe((reason) => {
          // Told nothing itself, this tab reads what the one that was told left beside the emptied key.
          const why = reason ?? tokenStore.endedBy?.();
          // A later sign-out with no reason must not erase why the first one happened.
          if (why) setSignedOutReason(why);
          clearSession();
        }),
      [clearSession],
    );

    const signIn = useCallback(
      (session: AuthSessionResponse) => {
        setSignedOutReason(null);
        tokenStore.set(session.tokens);
        setHasToken(true);
        queryClient.setQueryData(queryKey, session.identity);
        onSignedIn?.();
      },
      [queryClient],
    );

    const signOut = useCallback(async () => {
      // Refused, failed or never answered, this device is cleared all the same.
      await settledWithin(endpoints.logout(), SIGN_OUT_WAIT_MS);
      clearSession();
    }, [clearSession]);

    const value = useMemo(() => {
      // `hasToken` first: the cached identity outlives the token by a render or two.
      const identity = (
        hasToken && data !== undefined && data.actor === actor ? data : null
      ) as TIdentity | null;

      return {
        identity,
        // Only "loading" if there is a token to load an identity for.
        isLoading: isLoading && hasToken,
        // Paused offline, or failed with no refusal: the token is still good for all anyone knows.
        isUnreachable:
          hasToken &&
          data === undefined &&
          (isPaused || (error !== null && isWorthAskingAgain(error))),
        retry: () => void refetch(),
        signIn,
        signOut,
        signedOutReason,
        ...(extend?.(identity) ?? ({} as TExtra)),
      } as AuthState<TIdentity> & TExtra;
    }, [data, error, hasToken, isLoading, isPaused, refetch, signIn, signOut, signedOutReason]);

    return (
      <AuthContext key={swaps} value={value}>
        {children}
      </AuthContext>
    );
  }

  function useAuth(): AuthState<TIdentity> & TExtra {
    const context = use(AuthContext);
    if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
    return context;
  }

  return { AuthProvider, useAuth };
}
