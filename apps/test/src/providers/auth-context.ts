import { createContext, use } from 'react';
import { type AuthSessionResponse, type StudentIdentity } from '@iace/contracts';

export interface AuthContextValue {
  student: StudentIdentity | null;
  isLoading: boolean;
  signIn: (session: AuthSessionResponse) => void;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
