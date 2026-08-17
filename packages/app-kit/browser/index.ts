import {
  createTokenStore,
  type KeyValueStorage,
  type SignOutSignal,
  type TokenStore,
} from '../src';

/**
 * The web half of app-kit — the only place here that may touch the DOM.
 * Outside `src` because the DOM ban in `@iace/config/eslint-no-dom` is scoped to `src/**`.
 */

/** `localStorage`, narrowed to the three methods a token store uses. */
export const browserStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

/** Broadcast when a refresh fails, so the auth context can drop the session. */
export const SIGNED_OUT_EVENT = 'iace:signed-out';

/** A window event: the API client that raises it has no reference to the React tree. */
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

// --- the web app scaffolding ------------------------------------------------
// These compose @iace/ui and react-router-dom, which is why they are not in `src/`.
export { AppProviders } from './app-providers';
export { AppShell, type AppShellProps, type NavItem, type ShellWidth } from './app-shell';
export { mountApp } from './mount-app';
export { ProtectedRoute } from './protected-route';
