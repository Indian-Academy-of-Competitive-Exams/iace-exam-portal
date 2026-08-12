import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActorTypes, type AuthSessionResponse, type StudentIdentity } from '@iace/contracts';
import { api, tokenStore } from '../lib/api';
import { SIGNED_OUT_EVENT } from '@iace/app-kit';
import { AuthContext, ME_QUERY_KEY, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();

  // The stored token is the source of truth for "am I signed in"; /auth/me
  // re-reads the identity from Postgres so a profile change lands on reload.
  const { data, isLoading } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.auth.me(),
    enabled: tokenStore.get() !== null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const clearSession = useCallback(() => {
    tokenStore.clear();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  }, [queryClient]);

  // Fired by the API client when a refresh fails — the session is unrecoverable.
  useEffect(() => {
    window.addEventListener(SIGNED_OUT_EVENT, clearSession);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, clearSession);
  }, [clearSession]);

  const signIn = useCallback(
    (session: AuthSessionResponse) => {
      tokenStore.set(session.tokens);
      queryClient.setQueryData(ME_QUERY_KEY, session.identity);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Already invalid server-side; clearing locally is still correct.
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => {
    // This app only ever holds a student token; anything else is not a session
    // here, and the server enforces the same split.
    const student: StudentIdentity | null =
      data !== undefined && data.actor === ActorTypes.STUDENT ? data : null;

    return {
      student,
      isLoading: isLoading && tokenStore.get() !== null,
      signIn,
      signOut,
    };
  }, [data, isLoading, signIn, signOut]);

  return <AuthContext value={value}>{children}</AuthContext>;
}
