import { type AuthTokens } from '@iace/contracts';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * The seam between "where tokens are kept" and everything that reads them.
 *
 * Deliberately the shape of `localStorage` and deliberately SYNCHRONOUS: the
 * API client has to be able to read the current token from any call site,
 * including a background refresh, without awaiting. The web adapter is
 * `localStorage`; a future Expo app supplies SecureStore's sync accessors or
 * MMKV. This package never learns which (docs/03 §3).
 */
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
 * Token persistence, kept outside React so the API client can read the current
 * token synchronously from any call site (including a background refresh).
 *
 * The storage key is a PARAMETER, and every app must pass its own. Admin, test
 * and the student portal to come all share one browser origin: a shared key
 * would mean whichever app loaded last silently clobbered the other's session,
 * and an admin token would be handed to a student's requests.
 *
 * The STORAGE is a parameter for a different reason — see `KeyValueStorage`.
 * `@iace/app-kit/browser` has the localStorage one ready to pass.
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
