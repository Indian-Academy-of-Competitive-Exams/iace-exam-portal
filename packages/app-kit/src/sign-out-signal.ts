/**
 * The one-way channel from "the refresh token is gone too" to "drop the
 * session and show the login screen".
 *
 * It exists as an interface rather than a `window` event because the API client
 * that raises it and the auth provider that listens for it are both in the
 * DOM-free tier (docs/03 §3). The web adapter dispatches a window event; Expo
 * would use a `DeviceEventEmitter`, and neither one is this package's business.
 *
 * `subscribe` returns its own unsubscribe, so a caller that has the handle to
 * start listening cannot fail to have the handle to stop.
 */
export interface SignOutSignal {
  emit(): void;
  subscribe(handler: () => void): () => void;
}

/**
 * A signal with no platform under it.
 *
 * Not a test double — it is what a caller gets when the platform has nothing
 * to broadcast on, and it means the sign-out path still works in-process
 * rather than silently doing nothing.
 */
export function createLocalSignOutSignal(): SignOutSignal {
  const handlers = new Set<() => void>();

  return {
    emit: () => handlers.forEach((handler) => handler()),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
