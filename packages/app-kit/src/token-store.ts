import { type AuthTokens } from '@iace/contracts';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStore {
  get(): StoredTokens | null;
  set(tokens: AuthTokens): void;
  clear(): void;
}

/** Broadcast when a refresh fails, so the auth context can drop the session. */
export const SIGNED_OUT_EVENT = 'iace:signed-out';

/**
 * Token persistence, kept outside React so the API client can read the current
 * token synchronously from any call site (including a background refresh).
 *
 * The storage key is a PARAMETER, and every app must pass its own. Admin, test
 * and the student portal to come all share one browser origin: a shared key
 * would mean whichever app loaded last silently clobbered the other's session,
 * and an admin token would be handed to a student's requests.
 */
export function createTokenStore(storageKey: string): TokenStore {
  return {
    get(): StoredTokens | null {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as StoredTokens) : null;
      } catch {
        // Unreadable or unparseable is the same as signed out — a corrupt entry
        // must not throw on every single request.
        return null;
      }
    },

    set(tokens: AuthTokens): void {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      );
    },

    clear(): void {
      localStorage.removeItem(storageKey);
    },
  };
}
