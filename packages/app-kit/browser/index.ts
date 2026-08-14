import {
  createTokenStore,
  type KeyValueStorage,
  type SignOutSignal,
  type TokenStore,
} from '../src';

/**
 * The web half of app-kit — the only place in this package that may touch the
 * DOM, and the reason `src` never has to (docs/03 §3).
 *
 * It sits OUTSIDE `src` rather than beside the rest of the package because the
 * DOM ban in `@iace/config/eslint-no-dom` is scoped to `src/**`: the line
 * between the portable tier and the web tier is a directory, so it is visible
 * in a file tree and enforced by lint rather than remembered.
 *
 * It lives here rather than in each SPA because both of them need exactly this
 * and would otherwise hold two copies of it — the thing docs/03 §2 exists to
 * prevent. A future Expo app imports `@iace/app-kit` and never this file.
 */

/** `localStorage`, narrowed to the three methods a token store uses. */
export const browserStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/** Broadcast when a refresh fails, so the auth context can drop the session. */
export const SIGNED_OUT_EVENT = 'iace:signed-out';

/**
 * A window event, so any part of the app can hear it — the API client that
 * raises it has no reference to the React tree that has to react.
 */
export const browserSignOutSignal: SignOutSignal = {
  emit: () => window.dispatchEvent(new Event(SIGNED_OUT_EVENT)),
  subscribe: (handler) => {
    window.addEventListener(SIGNED_OUT_EVENT, handler);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, handler);
  },
};

/** The token store every web SPA wants, with only its storage key to choose. */
export function createBrowserTokenStore(storageKey: string): TokenStore {
  return createTokenStore(storageKey, browserStorage);
}
