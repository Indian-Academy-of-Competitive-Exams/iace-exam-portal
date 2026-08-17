import { type AuthTokens } from '@iace/contracts';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/** The storage seam. Synchronous, so the API client can read a token from any call site. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TokenStore {
  get(): StoredTokens | null;
  set(tokens: AuthTokens): void;
  clear(): void;
}

/**
 * Token persistence, outside React. Every app passes its OWN key: the SPAs share one
 * origin, and a shared key would hand an admin's token to a student's requests.
 */
export function createTokenStore(storageKey: string, storage: KeyValueStorage): TokenStore {
  return {
    get(): StoredTokens | null {
      try {
        const raw = storage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as StoredTokens) : null;
      } catch {
        // Unreadable or unparseable is the same as signed out — a corrupt entry
        // must not throw on every single request.
        return null;
      }
    },

    set(tokens: AuthTokens): void {
      storage.setItem(
        storageKey,
        JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }),
      );
    },

    clear(): void {
      storage.removeItem(storageKey);
    },
  };
}
