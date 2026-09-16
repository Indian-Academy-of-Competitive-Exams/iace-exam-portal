/** localStorage keys owned by this app, namespaced so the SPAs never read each other's. */
export const STORAGE_KEYS = {
  AUTH: 'iace.mobile.auth',
} as const;

/** The signed-in student's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The student catalog, cached under one key so a submit can drop it. */
export const CATALOG_QUERY_KEY = ['me', 'catalog'] as const;

/** Every test this student has sat — the web app's own key, so the two never disagree. */
export const PERFORMANCE_QUERY_KEY = ['me', 'performance'] as const;

/** One paper's brief — the web app's own key, so the two never cache the same read twice. */
export const briefQueryKey = (testId: string) => ['me', 'tests', testId, 'brief'] as const;

/** The session call doubles as the reachability check — its success proves both facts at once. */
export const SYSTEM_CHECK_QUERY_KEY = ['me', 'system-check'] as const;

/** The search param carrying the language choice to `/exam/[id]` — Task 6 reads this exact name. */
export const EXAM_LANGUAGES_PARAM = 'languages' as const;
