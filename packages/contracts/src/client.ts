import { createApiCore, type ApiClientOptions } from './client/core';
import { authClient } from './client/auth';
import type { meClient } from './client/me';
import type { adminClient } from './client/admin';

export { queryString, type ApiClientOptions } from './client/core';

type MeClient = ReturnType<typeof meClient>;
type AdminClient = ReturnType<typeof adminClient>;

/** A group's schemas load on its first call, so importing the client costs only auth and the envelope. */
export function lazyGroup<T extends object>(load: () => Promise<T>): T {
  let real: Promise<T> | undefined;
  // Admin nests its groups (`admin.dashboard.get`), so the proxy records the path and resolves it on call.
  const at = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      // What any function has (`name`, `valueOf`, `toString`) stays the function's: React's dev logging stringifies props.
      get: (target, prop) => {
        if (prop in target) return Reflect.get(target, prop);
        return typeof prop === 'symbol' || prop === 'then' ? undefined : at([...path, prop]);
      },
      apply(_target, _this, args: unknown[]) {
        // Loaded on CALL, never on access; a failed load is dropped so the next call retries it.
        real ??= load().catch((error: unknown) => {
          real = undefined;
          throw error;
        });
        return real.then((group) => {
          type Node = Record<string, unknown> | undefined;
          const owner = path
            .slice(0, -1)
            .reduce<Node>((node, key) => node?.[key] as Node, group as Node);
          const method = owner?.[path.at(-1) ?? ''];
          if (typeof method !== 'function') {
            throw new TypeError(`Unknown client method: ${path.join('.')}`);
          }
          return method.apply(owner, args);
        });
      },
    });
  return at([]) as T;
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
