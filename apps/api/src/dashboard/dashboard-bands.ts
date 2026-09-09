/**
 * Which bands a caller may see. Pure, so the gate is testable without a database and the service
 * cannot query for a band it then drops — a count it never runs is a count that cannot leak.
 */
import {
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  satisfiesLevel,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { type AuthenticatedUser } from '../common/security';

/** Mirrors FeaturePermissionGuard, including its order: a deactivated super admin holds nothing. */
export function holds(
  user: AuthenticatedUser,
  keys: readonly FeatureKey[],
  level: PermissionLevel = PERMISSION_LEVELS.READ,
): boolean {
  if (!user.isActive) return false;
  if (user.isSuperAdmin) return true;
  return keys.some((key) => satisfiesLevel(user.permissions[key], level));
}

export interface DashboardBands {
  students: boolean;
  catalog: boolean;
  questions: boolean;
  tests: boolean;
  bank: boolean;
  sittings: boolean;
  /** The audit trail is every admin's own, so the feed is the one band no key gates. */
  feed: boolean;
  windows: boolean;
}

/** The bank is authoring's screen too: a typist holds QUESTION_AUTHORING and not the bank key. */
const BANK_KEYS = [FEATURE_KEYS.QUESTION_MANAGEMENT, FEATURE_KEYS.QUESTION_AUTHORING] as const;

/** Scheduling lives on the test since the access revamp, so a test manager reads windows too. */
const WINDOW_KEYS = [FEATURE_KEYS.BRANCH_TEST_MANAGEMENT, FEATURE_KEYS.TEST_MANAGEMENT] as const;

export function bandsFor(user: AuthenticatedUser): DashboardBands {
  const students = holds(user, [FEATURE_KEYS.STUDENT_MANAGEMENT]);

  return {
    students,
    catalog: students,
    questions: holds(user, BANK_KEYS),
    tests: holds(user, [FEATURE_KEYS.TEST_MANAGEMENT]),
    bank: holds(user, BANK_KEYS),
    sittings: holds(user, [FEATURE_KEYS.STUDENT_PERFORMANCE]),
    feed: user.isActive,
    windows: holds(user, WINDOW_KEYS),
  };
}
