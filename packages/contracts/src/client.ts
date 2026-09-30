import { createApiCore, type ApiClientOptions } from './client/core';
import { authClient } from './client/auth';
import { meClient } from './client/me';
import { adminClient } from './client/admin';

export { type ApiClientOptions } from './client/core';

/** Callers never see the envelope: every method returns `data` or throws an `AppException`. */
export function createApiClient(options: ApiClientOptions) {
  const core = createApiCore(options);

  return { auth: authClient(core), me: meClient(core) };
}

/** Separate from the student client so the admin group and its schemas are not in either student bundle. */
export function createAdminApiClient(options: ApiClientOptions) {
  const core = createApiCore(options);

  return { auth: authClient(core), admin: adminClient(core) };
}
