import { STORAGE_KEYS } from './constants';

/** Per TAB, not per browser: sessionStorage is the one store a second tab does not share. */
export function tabId(): string {
  const held = sessionStorage.getItem(STORAGE_KEYS.TAB);
  if (held !== null) return held;

  const minted = crypto.randomUUID();
  sessionStorage.setItem(STORAGE_KEYS.TAB, minted);
  return minted;
}
