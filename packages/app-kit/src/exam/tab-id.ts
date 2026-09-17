import { type KeyValueStorage } from '../token-store';

/** The id this tab or device answers under: the stored one, or a fresh one stored for next time. */
export function tabIdFrom(storage: KeyValueStorage, key: string, mint: () => string): string {
  const held = storage.getItem(key);
  if (held !== null) return held;
  const minted = mint();
  storage.setItem(key, minted);
  return minted;
}
