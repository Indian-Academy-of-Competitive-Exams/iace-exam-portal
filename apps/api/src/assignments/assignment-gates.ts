import { type Prisma } from '@prisma/client';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  PAPER_SOURCES,
  dueStanding,
  type AssignmentRole,
  type DueStanding,
  type PaperSource,
} from '@iace/contracts';
import { beginDraftPaperEdit } from '../common/paper-edit';

const TEST_OFFERED_MESSAGE = 'This test has been offered, so its sections no longer change.';
const JOB_OVER_MESSAGE =
  'This section has been finished or passed to somebody else, so it is no longer yours to change.';

/** An assignment as its two actions read it: its own stamps, and its test's source and offer. */
interface GatedRow {
  role: AssignmentRole;
  replacedAt: Date | null;
  finalizedAt: Date | null;
  test: { paperSource: PaperSource | null; finalizedAt: Date | null };
}

/** A typist's Done is open: a typed section still theirs, not yet done, on a test not offered. */
export const doneOpen = (row: GatedRow): boolean =>
  row.role === ASSIGNMENT_ROLES.TYPIST &&
  row.replacedAt === null &&
  row.finalizedAt === null &&
  row.test.paperSource === PAPER_SOURCES.FRAMED &&
  row.test.finalizedAt === null;

/** Whether a holder's job is still theirs to work under: not finished, and not passed on. */
export async function jobOpen(
  db: Pick<Prisma.TransactionClient, 'questionAssignment'>,
  assignmentId: string,
): Promise<boolean> {
  const open = await db.questionAssignment.count({
    where: { id: assignmentId, finalizedAt: null, replacedAt: null },
  });
  return open > 0;
}

/** A job read again under its test's row: Done, a release and the offer all take it, so a write under the job lands before them or not at all. */
export async function assertJobOpen(
  tx: Prisma.TransactionClient,
  assignmentId: string,
): Promise<void> {
  const job = await tx.questionAssignment.findUnique({
    where: { id: assignmentId },
    select: { testId: true },
  });
  if (job) await beginDraftPaperEdit(tx, job.testId, TEST_OFFERED_MESSAGE);
  if (!(await jobOpen(tx, assignmentId))) {
    throw new AppException(ErrorCodes.CONFLICT, JOB_OVER_MESSAGE);
  }
}

/** A reader's release is open: the section has reached them, is still theirs, and is not released. */
export const readOpen = (row: GatedRow & { handedAt: Date | null }): boolean =>
  row.role === ASSIGNMENT_ROLES.PROOFREADER &&
  row.replacedAt === null &&
  row.handedAt !== null &&
  row.finalizedAt === null &&
  row.test.finalizedAt === null;

/** Its holder has a finish to give: a reader always, a typist only on a typed paper — a picked one has no Done. */
export const finishes = (row: Pick<GatedRow, 'role' | 'test'>): boolean =>
  row.role === ASSIGNMENT_ROLES.PROOFREADER || row.test.paperSource === PAPER_SOURCES.FRAMED;

/** Still owed: unfinished by a holder who can finish it, on a test not yet offered. */
export const owed = (row: GatedRow): boolean =>
  row.replacedAt === null &&
  row.finalizedAt === null &&
  row.test.finalizedAt === null &&
  finishes(row);

/** Where a row stands against its due day; null where nothing is owed on it and nothing was finished. */
export function standingOf(
  row: GatedRow & { dueAt: Date | null },
  today?: string,
): DueStanding | null {
  if (row.replacedAt !== null || !finishes(row)) return null;
  if (row.finalizedAt === null && !owed(row)) return null;
  return dueStanding(row, today);
}
