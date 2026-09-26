import { createApiCore, type ApiClientOptions } from './client/core';
import { authClient } from './client/auth';
import type { meClient } from './client/me';
import type { adminClient } from './client/admin';

export { queryString, type ApiClientOptions } from './client/core';

type MeClient = ReturnType<typeof meClient>;
type AdminClient = ReturnType<typeof adminClient>;

/** A group's schemas load on its first call, so importing the client costs only auth and the envelope. */
function lazyGroup<T extends object>(load: () => Promise<T>): T {
  let real: Promise<T> | undefined;
  return new Proxy({} as T, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => {
        // Assigned on CALL, never on access: touching the property must not pull the group in.
        real ??= load();
        return real.then((group) => {
          const method = group[prop as keyof T];
          if (typeof method !== 'function') {
            throw new TypeError(`Unknown client method: ${String(prop)}`);
          }
          return method(...args);
        });
      };
    },
  });
}

/** Callers never see the envelope: every method returns `data` or throws an `AppException`. */
export function createApiClient(options: ApiClientOptions) {
  const core = createApiCore(options);
  const { request, requestPaginated, requestBlob } = core;

  return {
    request,
    requestPaginated,
    requestBlob,
    auth: authClient(core),
    me: lazyGroup<MeClient>(() => import('./client/me').then((m) => m.meClient(core))),
    admin: lazyGroup<AdminClient>(() => import('./client/admin').then((m) => m.adminClient(core))),
  };
}
