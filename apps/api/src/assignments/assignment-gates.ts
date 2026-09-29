import {
  ASSIGNMENT_ROLES,
  PAPER_SOURCES,
  type AssignmentRole,
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
