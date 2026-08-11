import { type AuthTokens } from '@iace/contracts';
import { STORAGE_KEYS } from './constants';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Token persistence, kept outside React so the API client can read the current
 * token synchronously from any call site (including a background refresh).
 */
export const tokenStore = {
  get(): StoredTokens | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTH);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  },

  set(tokens: AuthTokens): void {
    localStorage.setItem(
      STORAGE_KEYS.AUTH,
      JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
    );
  },

  clear(): void {
    localStorage.removeItem(STORAGE_KEYS.AUTH);
  },
};

/** Broadcast when a refresh fails, so the auth context can drop the session. */
export const SIGNED_OUT_EVENT = 'iace:signed-out';
