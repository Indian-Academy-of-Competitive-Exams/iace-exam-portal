import { type AuthTokens } from '@iace/contracts';
import { type SignOutReason } from './sign-out-signal';

export type StoredTokens = Pick<AuthTokens, 'accessToken' | 'refreshToken'>;

/** The storage seam. Synchronous, so the API client can read a token from any call site. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TokenStore {
  get(): StoredTokens | null;
  set(tokens: AuthTokens): void;
  /** `reason` is for a store with other holders to leave beside the emptied key; one with none drops it. */
  clear(reason?: SignOutReason): void;
  /** Why the session last held here was ended, until the next sign-in; absent where the storage has one holder, as on a phone. */
  endedBy?(): SignOutReason | null;
  /** Told of a write made by another holder of the same storage, never of its own; absent where there is none, as on a phone. */
  subscribe?(onChange: () => void): () => void;
}

/** Token persistence, outside React; every app passes its OWN key since the SPAs share one origin, and a shared key would hand an admin's token to a student's requests. */
export function createTokenStore(storageKey: string, storage: KeyValueStorage): TokenStore {
  return {
    get(): StoredTokens | null {
      try {
        const raw = storage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as StoredTokens) : null;
      } catch {
        // Unreadable or unparseable is the same as signed out — a corrupt entry must not throw on every request.
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
