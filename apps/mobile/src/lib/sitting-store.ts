import Storage from 'expo-sqlite/kv-store';
import { randomUUID } from 'expo-crypto';
import { tabIdFrom, type KeyValueStorage } from '@iace/app-kit';
import { STORAGE_KEYS } from './constants';

/** SQLite, not SecureStore: the queue is neither a secret nor small, and a write must land synchronously. */
export const sittingStorage: KeyValueStorage = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
};

export const deviceTab = (): string => tabIdFrom(sittingStorage, STORAGE_KEYS.TAB, randomUUID);
