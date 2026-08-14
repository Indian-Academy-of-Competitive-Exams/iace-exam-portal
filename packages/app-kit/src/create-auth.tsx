import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type AuthIdentity, type AuthSessionResponse } from '@iace/contracts';
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';

/**
 * The session, from the point of view of a screen.
 *
 * `identity` is null whenever there is no usable session — no token, a token
 * that no longer works, or a token for the WRONG ACTOR. That last one is the
 * reason the actor is a parameter rather than something each app checks for
 * itself: a student's JWT is a perfectly valid JWT, and the admin app must not
 * treat it as a session even though nothing about it is malformed. The server
 * enforces the same split; this makes the client agree with it in one place.
 */
export interface AuthState<TIdentity> {
  identity: TIdentity | null;
  isLoading: boolean;
  signIn: (session: AuthSessionResponse) => void;
  signOut: () => Promise<void>;
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
  /**
   * App-specific reads over the identity, merged into the context value.
   *
   * The admin app's `canAccess` lives here. It is genuinely admin-only — page
   * permissions are an admin concept and a student identity has no pages — so
   * putting it in the shared shape would have meant every student screen
   * carrying a function that can only ever answer false.
   */
  extend?: (identity: TIdentity | null) => TExtra;
}

/**
 * One session implementation for every SPA.
 *
 * The four apps' providers were the same forty lines with one word changed, and
 * that word was the identity type. Which would be harmless if the forty lines
 * were boring — but they hold the rule that a stored token is the source of
 * truth for "am I signed in", the re-read of `/auth/me` that makes a permission
 * change land without a re-login, the sign-out signal subscription, and the
 * decision to clear locally when the server has already forgotten the session.
 * Four copies of that is four chances for one of them to get a detail wrong,
 * and the symptom of a wrong detail here is somebody stuck on a login screen
 * that will not admit they are signed in.
 */
export function createAuth<TIdentity extends AuthIdentity, TExtra extends object = object>(
  options: CreateAuthOptions<TIdentity, TExtra>,
): {
  AuthProvider: (props: Readonly<{ children: ReactNode }>) => ReactNode;
  useAuth: () => AuthState<TIdentity> & TExtra;
} {
  const { actor, queryKey, tokenStore, signOutSignal, endpoints, extend } = options;

  const AuthContext = createContext<(AuthState<TIdentity> & TExtra) | null>(null);

  function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
    const queryClient = useQueryClient();

    // The stored token is the source of truth for "am I signed in"; /auth/me
    // re-reads the identity from Postgres so a profile or permission change
    // lands on reload rather than at the next full sign-in.
    const { data, isLoading } = useQuery({
      queryKey,
      queryFn: () => endpoints.me(),
      enabled: tokenStore.get() !== null,
      retry: false,
      staleTime: 5 * 60 * 1000,
    });

    const clearSession = useCallback(() => {
      tokenStore.clear();
      queryClient.removeQueries({ queryKey });
    }, [queryClient]);

    // Raised by the API client when a refresh fails — the session is
    // unrecoverable, and nothing else is going to notice.
    useEffect(() => signOutSignal.subscribe(clearSession), [clearSession]);

    const signIn = useCallback(
      (session: AuthSessionResponse) => {
        tokenStore.set(session.tokens);
        queryClient.setQueryData(queryKey, session.identity);
      },
      [queryClient],
    );

    const signOut = useCallback(async () => {
      try {
        await endpoints.logout();
      } catch {
        // Already invalid server-side; clearing locally is still correct, and
        // refusing to sign out because the sign-out call failed would strand
        // the user in a session they have asked to end.
      }
      clearSession();
    }, [clearSession]);

    const value = useMemo(() => {
      const identity = (
        data !== undefined && data.actor === actor ? data : null
      ) as TIdentity | null;

      return {
        identity,
        // Only "loading" if there is a token to load an identity FOR. Without
        // this, a signed-out visitor sits on a spinner instead of the login
        // screen while a query that will never run reports as pending.
        isLoading: isLoading && tokenStore.get() !== null,
        signIn,
        signOut,
        ...(extend?.(identity) ?? ({} as TExtra)),
      } as AuthState<TIdentity> & TExtra;
    }, [data, isLoading, signIn, signOut]);

    return <AuthContext value={value}>{children}</AuthContext>;
  }

  function useAuth(): AuthState<TIdentity> & TExtra {
    const context = use(AuthContext);
    if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
    return context;
  }

  return { AuthProvider, useAuth };
}
