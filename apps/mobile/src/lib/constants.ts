/** localStorage keys owned by this app, namespaced so the SPAs never read each other's. */
export const STORAGE_KEYS = {
  AUTH: 'iace.mobile.auth',
} as const;

/** The signed-in student's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The student catalog, cached under one key so a submit can drop it. */
export const CATALOG_QUERY_KEY = ['me', 'catalog'] as const;
