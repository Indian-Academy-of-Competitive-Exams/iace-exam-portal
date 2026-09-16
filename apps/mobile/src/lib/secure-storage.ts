import { type KeyValueStorage } from '@iace/app-kit';

/** The three methods of expo-secure-store this needs, so a test can stand in for it. */
export interface SecureVault {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

/** SecureStore is async and KeyValueStorage is not, so the keys are mirrored in memory. */
export function createSecureStorage(
  keys: readonly string[],
  vault: SecureVault,
): { storage: KeyValueStorage; hydrate: () => Promise<void> } {
  const mirror = new Map<string, string>();

  return {
    storage: {
      getItem: (key) => mirror.get(key) ?? null,
      setItem: (key, value) => {
        mirror.set(key, value);
        void vault.setItemAsync(key, value);
      },
      removeItem: (key) => {
        mirror.delete(key);
        void vault.deleteItemAsync(key);
      },
    },
    hydrate: async () => {
      for (const key of keys) {
        try {
          const held = await vault.getItemAsync(key);
          if (held !== null) mirror.set(key, held);
        } catch {
          // Unreadable is the same as signed out — a corrupt keystore must not hang the splash.
        }
      }
    },
  };
}
