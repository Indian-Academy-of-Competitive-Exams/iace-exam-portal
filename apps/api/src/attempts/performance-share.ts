/**
 * The rules a public link lives and dies by. Pure on purpose: the one thing standing between
 * the open internet and a student's report should be readable in one screen and testable
 * without a database. Nothing here reaches a question, an option or an answer key.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  AppException,
  ErrorCodes,
  PERFORMANCE_SHARE_DEFAULT_DAYS,
  type PerformanceReport,
  type SharedReport,
} from '@iace/contracts';
import { endOfInstituteDay, instituteDayOf, shiftInstituteDay } from '../common/time/institute-day';

/** 32 bytes of cryptographic randomness — never a cuid, which is time-ordered and walkable. */
const SHARE_TOKEN_BYTES = 32;

const EXPIRES_ON_FIELD = 'expiresOn';
const EXPIRY_ALREADY_PASSED = 'Choose today or a later day — a link cannot expire in the past';

/** Under five sitters a topper IS the other student, and an average yields their mark by arithmetic. */
const SHARED_COHORT_FLOOR = 5;

export const newShareToken = (): string => randomBytes(SHARE_TOKEN_BYTES).toString('base64url');

/** A Redis key name is greppable in a way a bearer credential must not be, so the token is hashed. */
export const shareCacheKey = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');

export interface ShareLifetime {
  revokedAt: Date | null;
  expiresAt: Date | null;
}

/** Revoked or run out is refused; both are read on every request, never cached. */
export function shareIsLive(share: ShareLifetime, now: Date): boolean {
  if (share.revokedAt !== null) return false;
  return share.expiresAt === null || share.expiresAt.getTime() > now.getTime();
}

/** An omitted expiry takes the default; an explicit null is a link somebody meant to keep. */
export function shareExpiresAt(expiresOn: string | null | undefined, now: Date): Date | null {
  if (expiresOn === null) return null;
  if (expiresOn === undefined) {
    return endOfInstituteDay(
      shiftInstituteDay(instituteDayOf(now), PERFORMANCE_SHARE_DEFAULT_DAYS),
    );
  }

  const expiresAt = endOfInstituteDay(expiresOn);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new AppException(ErrorCodes.VALIDATION_ERROR, EXPIRY_ALREADY_PASSED, {
      fieldErrors: { [EXPIRES_ON_FIELD]: [EXPIRY_ALREADY_PASSED] },
    });
  }
  return expiresAt;
}

export interface ReportForSharing {
  report: PerformanceReport;
  studentName: string | null;
  branchName: string | null;
  submittedAt: string | null;
}

/** The whitelist. A field reaches the public payload because it is named here, never otherwise. */
export function sharedReportOf(input: ReportForSharing): SharedReport {
  const { report, studentName, branchName, submittedAt } = input;
  const cohortSize = report.cohort?.cohortSize ?? 0;
  const crowd = cohortSize >= SHARED_COHORT_FLOOR ? report.cohort : null;

  return {
    studentName,
    branchName,
    testTitle: report.label,
    submittedAt,
    score: report.composition.net,
    maxMarks: report.composition.maxMarks,
    rank: report.cohort?.rank ?? null,
    percentile: report.cohort?.percentile ?? null,
    cohortSize,
    averageScore: crowd?.averageScore ?? null,
    topperScore: crowd?.topperScore ?? null,
    bands: crowd?.bands ?? [],
    sections: report.sections.map((section) => ({
      name: section.name,
      score: section.score,
      maxMarks: section.maxMarks,
    })),
  };
}
