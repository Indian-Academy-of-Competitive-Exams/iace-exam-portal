import { type SignOutSignal } from '@iace/app-kit';

/** The RN half of the seam the browser fills with a window event. */
export function createSignOutSignal(): SignOutSignal {
  const handlers = new Set<() => void>();
  return {
    emit: () => handlers.forEach((handler) => handler()),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
