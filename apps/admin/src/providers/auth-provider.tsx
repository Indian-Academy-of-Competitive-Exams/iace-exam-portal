import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActorTypes, type AdminIdentity, type AuthSessionResponse } from '@iace/contracts';
import { api, tokenStore } from '../lib/api';
import { SIGNED_OUT_EVENT } from '@iace/app-kit';
import { AuthContext, ME_QUERY_KEY, type AuthContextValue } from './auth-context';

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();

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
    // A student token is not a session in the admin app, even though it is a
    // perfectly valid JWT — the server enforces the same split.
    const admin: AdminIdentity | null =
      data !== undefined && data.actor === ActorTypes.ADMIN ? data : null;

    return {
      admin,
      isLoading: isLoading && tokenStore.get() !== null,
      signIn,
      signOut,
      canAccess: (pageCode: string) =>
        admin !== null && (admin.isSuperAdmin || admin.pages.includes(pageCode)),
    };
  }, [data, isLoading, signIn, signOut]);

  return <AuthContext value={value}>{children}</AuthContext>;
}
