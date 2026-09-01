import { z } from 'zod';
import { civilDate, instituteDayLabel } from './common';
import { cohortCurveBandSchema } from './stats';
import { dateOnlySchema } from './students';

// ============================================================================
// A revocable public link onto ONE student's own report.
//
// This is the only unauthenticated route to student data in the platform, so
// the payload below is a WHITELIST, not a projection of something larger. It
// carries the shared student's own name and branch — a named achievement is
// the point of sharing — and nothing else that identifies anybody.
//
// Forbidden here, permanently: the answer key, per-question correctness, any
// other student's name or id, a topper's identity, leaderboard rows, a mobile
// number, an email, or an internal id somebody could walk. The cohort ships as
// an anonymous distribution: bands and counts, exactly as the signed-in curve
// draws them.
// ============================================================================

/** A share created without an explicit expiry dies this many institute days later. */
export const PERFORMANCE_SHARE_DEFAULT_DAYS = 30;

/** One section as the public report names it — no section id, nothing to enumerate. */
export const sharedSectionSchema = z.object({
  name: z.string(),
  score: z.number(),
  maxMarks: z.number(),
});
export type SharedSection = z.infer<typeof sharedSectionSchema>;

/** Everything a token buys. Every field is here because a reader of the link needs it. */
export const sharedReportSchema = z.object({
  studentName: z.string().nullable(),
  branchName: z.string().nullable(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
  score: z.number(),
  maxMarks: z.number(),
  rank: z.number().int().nullable(),
  percentile: z.number().nullable(),
  cohortSize: z.number().int(),
  averageScore: z.number().nullable(),
  /** The top MARK, never who scored it. A number is not an identity. */
  topperScore: z.number().nullable(),
  /** The cohort as bands and counts. No row, no name, no id. */
  bands: z.array(cohortCurveBandSchema),
  sections: z.array(sharedSectionSchema),
});
export type SharedReport = z.infer<typeof sharedReportSchema>;

/** A link as its owner sees it. `token` is null for a reader who may not hand a working one out. */
export const performanceShareSchema = z.object({
  id: z.string(),
  token: z.string().nullable(),
  attemptId: z.string(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Derived on every read, so a link that has run out never reads as live. */
  isLive: z.boolean(),
});
export type PerformanceShare = z.infer<typeof performanceShareSchema>;

/** A sitting that can be shared — an evaluated one. What the picker offers, and only that. */
export const shareableSittingSchema = z.object({
  attemptId: z.string(),
  testTitle: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type ShareableSitting = z.infer<typeof shareableSittingSchema>;

const UNTITLED_TEST = 'Untitled test';

/** How a sitting is named wherever one is picked: the paper, and the day it was sat. */
export function sittingLabel(sitting: ShareableSitting): string {
  const day = instituteDayLabel(sitting.submittedAt);
  const title = sitting.testTitle ?? UNTITLED_TEST;
  return day === null ? title : `${title} · ${day}`;
}

export const performanceSharesSchema = z.object({
  shares: z.array(performanceShareSchema),
  sittings: z.array(shareableSittingSchema),
});
export type PerformanceShares = z.infer<typeof performanceSharesSchema>;

/** An omitted `expiresOn` takes the 30-day default; an explicit null is a permanent link. */
export const createPerformanceShareSchema = z.object({
  attemptId: z.string().min(1),
  expiresOn: dateOnlySchema.nullish(),
});
export type CreatePerformanceShareInput = z.infer<typeof createPerformanceShareSchema>;

export const PERFORMANCE_SHARE_ROUTES = {
  /** The only unauthenticated route to student data. Read-only, token-addressed. */
  public: (token: string) => `/public/reports/${token}`,
  mine: '/me/performance/shares',
  revokeMine: (id: string) => `/me/performance/shares/${id}/revoke`,
  ofStudent: (studentId: string) => `/admin/students/${studentId}/performance/shares`,
  revokeOfStudent: (studentId: string, id: string) =>
    `/admin/students/${studentId}/performance/shares/${id}/revoke`,
} as const;

/** Where the student portal serves a shared report. The link the student copies is this path. */
export const sharedReportPath = (token: string) => `/r/${token}`;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Where the expiry picker opens: the default lifetime, as the civil date it lands on. */
export const defaultShareExpiry = (): string =>
  civilDate(new Date(Date.now() + PERFORMANCE_SHARE_DEFAULT_DAYS * MS_PER_DAY));

/** A `YYYY-MM-DD` picked in the browser, read back as the civil date it names, never a zone. */
const civilInstant = (day: string) => new Date(`${day}T00:00:00Z`);

/** What the confirm dialog tells the reader about the lifetime the picker is holding. */
export const shareExpiryLine = (expiresOn: string): string =>
  expiresOn === ''
    ? 'It never expires.'
    : `It stops working after ${instituteDayLabel(civilInstant(expiresOn))}.`;

/** The three states a link can be read in, derived from what the server derived `isLive` from. */
export const SHARE_STATUS = {
  LIVE: 'Live',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
} as const;
export type ShareStatus = (typeof SHARE_STATUS)[keyof typeof SHARE_STATUS];

export function shareStatusOf(share: Pick<PerformanceShare, 'isLive' | 'revokedAt'>): ShareStatus {
  if (share.isLive) return SHARE_STATUS.LIVE;
  return share.revokedAt === null ? SHARE_STATUS.EXPIRED : SHARE_STATUS.REVOKED;
}
