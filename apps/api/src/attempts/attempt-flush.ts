import { type Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, type AnswerState, type LiveAnswer } from '@iace/contracts';
import { type PrismaService } from '../prisma/prisma.service';
import { type HeldState } from './attempt-state';

/** What the flusher writes, worked out without a database so it can be read as a table. */

export interface FlushRow {
  questionId: string;
  data: {
    selectedOptionId: string | null;
    typedAnswer: string | null;
    state: AnswerState;
    timeSpentSec: number;
    answeredAt: Date | null;
    firstActionAt: Date | null;
  };
}

/** How many sittings one pass writes at a time. Lanes, not workers: one pass owns the dirty set. */
export const FLUSH_LANES = 8;

/** Ahead of the claim, so a call that lost the race cannot write over the winner's answers. */
export const STILL_LIVE = { attempt: { status: ATTEMPT_STATUS.IN_PROGRESS } } as const;

/** Every value comes off the held state and none off the clock, so running it twice is a no-op. */
export function rowsToFlush(held: HeldState, only?: readonly string[]): FlushRow[] {
  const wanted = only === undefined ? null : new Set(only);
  return Object.entries(held.answers)
    .filter(([questionId]) => wanted === null || wanted.has(questionId))
    .map(([questionId, answer]) => ({
      questionId,
      data: {
        selectedOptionId: answer.selectedOptionId,
        typedAnswer: answer.typedAnswer,
        state: answer.state,
        timeSpentSec: answer.timeSpentSec,
        answeredAt: answer.answeredAt === null ? null : new Date(answer.answeredAt),
        firstActionAt: answer.firstActionAt === null ? null : new Date(answer.firstActionAt),
      },
    }));
}

/** What a durable answer row carries back into the live state. */
export const DURABLE_ANSWER_SELECT = {
  questionId: true,
  state: true,
  selectedOptionId: true,
  typedAnswer: true,
  timeSpentSec: true,
  answeredAt: true,
  firstActionAt: true,
} as const satisfies Prisma.AttemptQuestionSelect;

/** The flush read backwards: what a lost live key is put back from, so a resume keeps its answers. */
export function answersFromRows(
  rows: readonly Prisma.AttemptQuestionGetPayload<{ select: typeof DURABLE_ANSWER_SELECT }>[],
): Record<string, LiveAnswer> {
  const answers: Record<string, LiveAnswer> = {};
  for (const row of rows) {
    answers[row.questionId] = {
      state: row.state,
      selectedOptionId: row.selectedOptionId,
      typedAnswer: row.typedAnswer,
      timeSpentSec: row.timeSpentSec,
      answeredAt: row.answeredAt?.toISOString() ?? null,
      firstActionAt: row.firstActionAt?.toISOString() ?? null,
    };
  }
  return answers;
}

/** Idempotent: every value comes off the held state, so writing it twice writes the same row. */
export async function writeRows(
  prisma: PrismaService,
  attemptId: string,
  rows: readonly FlushRow[],
  gate: Prisma.AttemptQuestionWhereInput = {},
): Promise<void> {
  if (rows.length === 0) return;
  // The batched form: one round trip for the whole paper, on the path 5K students converge on.
  await prisma.$transaction(
    rows.map((row) =>
      prisma.attemptQuestion.updateMany({
        where: { attemptId, questionId: row.questionId, ...gate },
        data: row.data,
      }),
    ),
  );
}
