/**
 * One-way channel from "the refresh token is gone" to "show the login screen".
 * An interface, not a window event: both ends live in the DOM-free tier.
 */
export interface SignOutSignal {
  emit(): void;
  subscribe(handler: () => void): () => void;
}

/** What a caller gets when the platform has nothing to broadcast on. Not a test double. */
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
