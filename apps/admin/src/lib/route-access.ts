import { filterNavBy } from '@iace/app-kit';
import {
  FEATURE_KEYS,
  type FeatureKey,
  PERMISSION_LEVELS,
  type PermissionLevel,
} from '@iace/contracts';
import { ROUTES } from './constants';
import { type AdminNavItem } from './nav';

/** What a screen's own requests need: any one of `keys` at `level`, as the API's guards read them. */
export interface RouteAccess {
  keys: readonly FeatureKey[];
  level: PermissionLevel;
}

type Can = (key: FeatureKey, level: PermissionLevel) => boolean;

const reads = (...keys: FeatureKey[]): RouteAccess => ({ keys, level: PERMISSION_LEVELS.READ });
const writes = (...keys: FeatureKey[]): RouteAccess => ({ keys, level: PERMISSION_LEVELS.WRITE });

/** Either half of the section work shares one queue, so the API answers both keys on it. */
const ASSIGNEE_KEYS = [FEATURE_KEYS.QUESTION_AUTHORING, FEATURE_KEYS.QUESTION_PROOFREAD] as const;

/** A section answers to its typist, its proof-reader and the test's owner alike. */
export const SECTION_KEYS = [...ASSIGNEE_KEYS, FEATURE_KEYS.TEST_MANAGEMENT] as const;

/** Each screen's guard as its endpoints state it: a read to open one, a write to make one. Unlisted is every admin's, or a super admin's below. */
export const ROUTE_ACCESS: Readonly<Partial<Record<string, RouteAccess>>> = {
  [ROUTES.STUDENTS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.STUDENT_PATTERN]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.IMPORT_STUDENTS]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.BRANCHES]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.EXAMS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.COHORTS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.EVENT_IMPORT_PATTERN]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.PROGRAM_IMPORT_PATTERN]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  // The list endpoint also answers a test owner, for the picker; the bank's own screens do not.
  [ROUTES.QUESTIONS]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_PATTERN]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_NEW]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_EDIT_PATTERN]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.IMPORT_QUESTIONS]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.TAXONOMY]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT, ...SECTION_KEYS),
  [ROUTES.TYPING_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.READING_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.TEST_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.PROOFREADING_ASSIGNMENTS]: reads(...ASSIGNEE_KEYS),
  [ROUTES.AUTHORING_ASSIGNMENTS]: reads(...ASSIGNEE_KEYS),
  [ROUTES.AUTHORING_HISTORY]: reads(FEATURE_KEYS.QUESTION_AUTHORING),
  // A blank editor has nothing to read; one opened on a question shows it read-only below WRITE.
  [ROUTES.AUTHORING_EDITOR]: writes(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.AUTHORING_EDITOR_PATTERN]: reads(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.AUTHORING_IMPORT_PATTERN]: writes(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.BASE_CONFIGS]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.BASE_CONFIG_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.BASE_CONFIG_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TESTS]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_IMPORT_PATTERN]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PAPER_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PAPER_PRINT_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_ANALYTICS_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_SERIES_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_SERIES_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.LIVE_OPS]: reads(FEATURE_KEYS.TEST_OPERATIONS),
  [ROUTES.ANNOUNCEMENTS]: reads(FEATURE_KEYS.NOTIFICATION_MANAGEMENT),
  [ROUTES.REPORTS]: reads(FEATURE_KEYS.REPORTS),
  [ROUTES.SUPPORT]: reads(FEATURE_KEYS.SUPPORT),
  [ROUTES.SUPPORT_TICKET_PATTERN]: reads(FEATURE_KEYS.SUPPORT),
  [ROUTES.REPORT_PATTERN]: reads(FEATURE_KEYS.REPORTS),
};

/** The screens that decide who decides, and the log of what everybody did: no key opens them, only a super admin. */
const SUPER_ADMIN_ROUTES: ReadonlySet<string> = new Set([
  ROUTES.ADMINS,
  ROUTES.PERMISSIONS,
  ROUTES.SECTION_PROGRESS,
  ROUTES.AUDIT,
  ROUTES.AUDIT_IMPORTS,
]);

interface RouteViewer {
  isSuperAdmin: boolean;
  can: Can;
}

/** Whether the viewer may open a route pattern; a super admin passes inside `can`. */
export function opensRoute(path: string, viewer: RouteViewer): boolean {
  if (SUPER_ADMIN_ROUTES.has(path)) return viewer.isSuperAdmin;
  const access = ROUTE_ACCESS[path];
  return access === undefined || access.keys.some((key) => viewer.can(key, access.level));
}

/** Strips `superAdminOnly` and any row whose screen would refuse the viewer. `featureKey` is the shell's job. */
export function filterAdminNav(
  items: readonly AdminNavItem[],
  viewer: RouteViewer,
): AdminNavItem[] {
  return filterNavBy(
    items,
    (item) =>
      (Boolean(item.superAdminOnly) && !viewer.isSuperAdmin) ||
      (item.to !== undefined && !opensRoute(item.to, viewer)),
  );
}
