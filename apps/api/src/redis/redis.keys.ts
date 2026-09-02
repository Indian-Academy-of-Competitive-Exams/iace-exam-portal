import { type ActorType } from '@iace/contracts';

/**
 * Every Redis key the platform uses is minted here, so the keyspace stays greppable and no two
 * features collide on a prefix.
 */
export const redisKeys = {
  /** The pending OTP for one identity. Holds the HMAC of the code, never the code. */
  otp: (actor: ActorType, identifier: string) => `otp:${actor.toLowerCase()}:${identifier}`,

  /** Set while a resend is refused; its TTL is the remaining cooldown. */
  otpCooldown: (actor: ActorType, identifier: string) =>
    `otp:cooldown:${actor.toLowerCase()}:${identifier}`,

  /**
   * A student's consecutive failed PIN attempts. Cleared on success, and by its own TTL, so an
   * occasional typo never accumulates into a lockout.
   */
  pinAttempts: (mobile: string) => `pin:attempts:${mobile}`,

  /** Present while a student is locked out of PIN login; TTL = time remaining. */
  pinLock: (mobile: string) => `pin:lock:${mobile}`,

  /** How many times this number has been locked out recently — the rung of the escalation ladder. */
  pinLockouts: (mobile: string) => `pin:lockouts:${mobile}`,

  /** Hash of the single-use ticket that authorises setting a PIN after an OTP. */
  pinSetup: (mobile: string) => `pin:setup:${mobile}`,

  /** One refresh session: token hash + device binding. TTL = refresh lifetime. */
  session: (actor: ActorType, subjectId: string, sessionId: string) =>
    `session:${actor.toLowerCase()}:${subjectId}:${sessionId}`,

  /** Index of a subject's live session ids — powers "sign out everywhere". */
  sessionIndex: (actor: ActorType, subjectId: string) =>
    `sessions:${actor.toLowerCase()}:${subjectId}`,

  /** Held while one worker archives one UTC day of audit rows, keyed `YYYY-MM-DD`. */
  auditArchiveDay: (day: string) => `audit:archive:${day}`,

  /**
   * The platform-wide catalog bust counter. A series-wide change is one INCR here, and every
   * student's key at the old epoch falls out by its TTL — a SCAN would not survive 100k students.
   */
  catalogEpoch: 'access:catalog:epoch',

  /**
   * One student's own bust counter. INCR, never DEL: a delete landing between a cache miss and
   * the write behind it re-pins the pre-change answer for the whole TTL.
   */
  catalogStudentEpoch: (studentId: string) => `access:catalog:${studentId}:epoch`,

  /** One live sitting: answers, section clocks and the facts a save is judged against. */
  attemptState: (attemptId: string) => `attempt:state:${attemptId}`,

  /** Attempts holding writes Postgres has not seen. A SET, so draining needs no SCAN. */
  attemptsDirty: 'attempt:dirty',

  /** One test's ranking: a sorted set of attempt ids scored by marks-then-speed, packed as one double. */
  testLeaderboard: (testId: string) => `test:leaderboard:${testId}`,

  /** Held while one worker puts a board back, so a wiped Redis is rebuilt once and not per reader. */
  testLeaderboardRebuild: (testId: string) => `test:leaderboard:${testId}:rebuilding`,

  /** One public report, keyed by a DIGEST of its link — a key name must never carry a credential. */
  sharedReport: (linkDigest: string) => `share:report:${linkDigest}`,

  /** How often one link has missed that cache in the current window. TTL = what is left of it. */
  sharedReportReads: (linkDigest: string) => `share:reads:${linkDigest}`,

  /** One caller's hits in one rate-limit window. The tracker is a subject id or an address, never a credential. */
  rateLimit: (name: string, tracker: string) => `ratelimit:${name}:${tracker}`,

  /** One student's resolved catalog, at one payload shape and both epochs. */
  studentCatalog: (studentId: string, shape: string, epoch: number, studentEpoch: number) =>
    `access:catalog:${studentId}:${shape}:${epoch}.${studentEpoch}`,
} as const;
