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
import { type TokenStore } from './token-store';
import { type SignOutSignal } from './sign-out-signal';

/**
 * The session as a screen sees it. `identity` is null with no token, a dead token,
 * or a token for the wrong actor — a student's JWT is valid and is not an admin session.
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
  /** App-specific reads over the identity, merged into the context value. */
  extend?: (identity: TIdentity | null) => TExtra;
}

/** One session implementation for every SPA, parameterised by the identity type. */
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

    /**
     * Whether a token exists, in React state — the store is outside React, so
     * writing to it notifies nothing that renders.
     */
    const [hasToken, setHasToken] = useState(() => tokenStore.get() !== null);

    // /auth/me re-reads the identity, so a permission change lands on reload.
    const { data, isLoading } = useQuery({
      queryKey,
      queryFn: () => endpoints.me(),
      enabled: hasToken,
      retry: false,
      staleTime: 5 * 60 * 1000,
    });

    const clearSession = useCallback(() => {
      tokenStore.clear();
      setHasToken(false);
      queryClient.removeQueries({ queryKey });
    }, [queryClient]);

    // Raised by the API client when a refresh fails — the session is
    // unrecoverable, and nothing else is going to notice.
    useEffect(() => signOutSignal.subscribe(clearSession), [clearSession]);

    const signIn = useCallback(
      (session: AuthSessionResponse) => {
        tokenStore.set(session.tokens);
        setHasToken(true);
        queryClient.setQueryData(queryKey, session.identity);
      },
      [queryClient],
    );

    const signOut = useCallback(async () => {
      try {
        await endpoints.logout();
      } catch {
        // Already invalid server-side; clear locally anyway.
      }
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
        signIn,
        signOut,
        ...(extend?.(identity) ?? ({} as TExtra)),
      } as AuthState<TIdentity> & TExtra;
    }, [data, hasToken, isLoading, signIn, signOut]);

    return <AuthContext value={value}>{children}</AuthContext>;
  }

  function useAuth(): AuthState<TIdentity> & TExtra {
    const context = use(AuthContext);
    if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
    return context;
  }

  return { AuthProvider, useAuth };
}
