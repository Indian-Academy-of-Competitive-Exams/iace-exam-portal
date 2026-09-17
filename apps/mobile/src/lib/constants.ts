import { type PerformanceScope } from '@iace/contracts';

/** Storage keys owned by this app, namespaced the way the SPAs name their localStorage keys. */
export const STORAGE_KEYS = {
  AUTH: 'iace.mobile.auth',
  /** Per install: what tells the server this device is the one answering. */
  TAB: 'iace.mobile.tab',
  /** Answers a save has not delivered yet, kept on the phone until one does. */
  QUEUED_ANSWERS: 'iace.mobile.queued',
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

/** Where this account is signed in — the web app's own key, so the two never cache separate copies. */
export const ACTIVE_DEVICES_QUERY_KEY = ['me', 'sessions'] as const;

/** The search param carrying the language choice to `/exam/[testId]`. */
export const EXAM_LANGUAGES_PARAM = 'languages' as const;

/** The sitting, keyed by TEST — the web app's own key, so a refetch can never be a second start. */
export const startedAttemptQueryKey = (testId: string) => ['me', 'attempt', testId] as const;

/** The paper an attempt draws, stamped with when it landed — the web app's own key. */
export const attemptPaperQueryKey = (attemptId: string) =>
  ['me', 'attempt-paper', attemptId] as const;

/** Marks and standing, refused until marking lands — the web app's own key. */
export const scoreCardQueryKey = (attemptId: string) =>
  ['me', 'attempts', attemptId, 'score-card'] as const;

/** One report, keyed by what it is OF — the web app's own key, so the two share one read. */
export const performanceReportQueryKey = (scope: PerformanceScope, scopeId: string) =>
  ['me', 'performance', 'report', scope, scopeId] as const;

/** What a sitting knew about itself as it ended. Put in the cache by the exam, never fetched. */
export const endedSittingQueryKey = (attemptId: string) =>
  ['me', 'attempts', attemptId, 'ended'] as const;
