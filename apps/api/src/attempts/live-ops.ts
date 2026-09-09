import { ANSWERED_STATES, type AnswerState, type LiveSitting } from '@iace/contracts';
import { type HeldState } from './attempt-state';

/** What the ops board shows, worked out without a database so the split can be read as a table. */

/** A sitting row as Postgres hands it over, before the live state is laid on top. */
export interface SittingRow {
  id: string;
  studentId: string;
  attemptNo: number;
  isGraded: boolean;
  startedAt: Date;
  endsAt: Date;
  student: {
    fullName: string | null;
    mobile: string;
    currentBranch: { name: string } | null;
  };
}

const ANSWERED = new Set<AnswerState>(ANSWERED_STATES);

/** Answered as the palette counts it: marked-for-review with an answer in it still counts. */
export function answeredCountOf(held: HeldState): number {
  return Object.values(held.answers).filter((answer) => ANSWERED.has(answer.state)).length;
}

export function toLiveSitting(
  row: SittingRow,
  held: HeldState | null,
  questionCount: number,
): LiveSitting {
  return {
    attemptId: row.id,
    studentId: row.studentId,
    studentName: row.student.fullName,
    mobile: row.student.mobile,
    branchName: row.student.currentBranch?.name ?? null,
    attemptNo: row.attemptNo,
    isGraded: row.isGraded,
    startedAt: row.startedAt.toISOString(),
    // Redis is authoritative while a sitting runs; the row's deadline stands when the key has gone.
    endsAt: held?.endsAt ?? row.endsAt.toISOString(),
    questionCount,
    answeredCount: held === null ? null : answeredCountOf(held),
    hasLiveState: held !== null,
  };
}

/** One panel's rows, with whatever live state each still has laid over it. */
export function sittingsFrom(
  rows: readonly SittingRow[],
  held: ReadonlyMap<string, HeldState>,
  questionCount: number,
): LiveSitting[] {
  return rows.map((row) => toLiveSitting(row, held.get(row.id) ?? null, questionCount));
}
