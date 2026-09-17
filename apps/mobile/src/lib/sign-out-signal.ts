import { type SignOutReason, type SignOutSignal } from '@iace/app-kit';

/** The RN half of the seam the browser fills with a window event. */
export function createSignOutSignal(): SignOutSignal {
  const handlers = new Set<(reason?: SignOutReason) => void>();
  return {
    emit: (reason) => handlers.forEach((handler) => handler(reason)),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
