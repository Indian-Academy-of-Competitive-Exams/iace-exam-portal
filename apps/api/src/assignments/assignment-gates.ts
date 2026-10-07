import {
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  dueStanding,
  type AssignmentRole,
  type DueStanding,
  type PaperSource,
} from '@iace/contracts';

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
