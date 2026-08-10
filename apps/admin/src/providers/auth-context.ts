import { createContext, use } from 'react';
import { type AdminIdentity, type AuthSessionResponse } from '@iace/contracts';

export interface AuthContextValue {
  admin: AdminIdentity | null;
  isLoading: boolean;
  signIn: (session: AuthSessionResponse) => void;
  signOut: () => Promise<void>;
  /** Mirrors the server-side PagePermissionGuard: super admins bypass checks. */
  canAccess: (pageCode: string) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
